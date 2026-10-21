// LRCLIB (https://lrclib.net): a free, open database of synced lyrics.
// GET /api/get matches a song by track, artist, album and duration (within
// about 2 seconds). 404 means it has nothing; when it is overloaded it answers
// 503 even for songs it would not find, so 429/5xx only mean "try later".

export class RetryableError extends Error {
  constructor(message, { retryAfterSeconds } = {}) {
    super(message);
    this.name = 'RetryableError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Results: { kind: 'found', id, synced, plain } | { kind: 'instrumental', id }
 * | { kind: 'missing' }. Throws RetryableError when LRCLIB can't answer now.
 */
export function createLrclibClient({ baseUrl, userAgent, timeoutMs = 15_000 }) {
  async function get(params) {
    const url = new URL('/api/get', baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

    let res;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new RetryableError(`LRCLIB could not be reached (${err.cause?.code ?? err.name})`);
    }
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new RetryableError(`LRCLIB answered ${res.status}`, {
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    }
    if (!res.ok) return null; // 400: it couldn't use the query, so it has nothing for us
    return res.json();
  }

  return {
    async lookup({ title, artist, album, duration }) {
      const query = { track_name: title, artist_name: artist, duration: Math.round(duration) };
      // Albums are often tagged differently ("Deluxe Edition", "Remastered"), so
      // a miss with the album gets one more try without it.
      let hit = await get(album ? { ...query, album_name: album } : query);
      if (!hit && album) hit = await get(query);

      if (!hit) return { kind: 'missing' };
      if (hit.instrumental) return { kind: 'instrumental', id: hit.id };
      if (!hit.syncedLyrics && !hit.plainLyrics) return { kind: 'missing' };
      return { kind: 'found', id: hit.id, synced: hit.syncedLyrics || null, plain: hit.plainLyrics || null };
    },
  };
}
