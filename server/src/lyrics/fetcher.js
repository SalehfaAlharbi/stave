import { RetryableError } from './lrclib.js';

const MINUTE = 60_000;
// Waits after a failed attempt (LRCLIB busy or unreachable); then it gives up.
const BACKOFF = [1, 5, 30, 120, 720].map((m) => m * MINUTE);

/**
 * Looks up lyrics in the background, one song at a time and politely spaced,
 * so uploading an album doesn't hit LRCLIB with a burst. Work survives
 * restarts because the queue is the lyrics table itself.
 */
export function createLyricsFetcher({ store, findTrack, client, log, spacingMs = 1000 }) {
  let timer = null;
  let stopped = false;
  let running = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Asks LRCLIB about one track and stores the answer. Returns the result kind. */
  async function lookup(trackId, { onlyPending }) {
    const track = findTrack(trackId);
    if (!track) return 'gone';
    if (!track.artist || !track.duration) {
      // LRCLIB matches on artist, title and length; without them there is nothing to ask.
      store.saveLookup(trackId, { kind: 'missing' }, { onlyPending, error: 'needs an artist and a length' });
      return 'missing';
    }
    const result = await client.lookup({ title: track.title, artist: track.artist, album: track.album, duration: track.duration });
    if (!stopped) store.saveLookup(trackId, result, { onlyPending });
    return result.kind;
  }

  async function drain() {
    for (let job = store.nextDue(); job && !stopped; job = store.nextDue()) {
      try {
        const kind = await lookup(job.track_id, { onlyPending: true });
        log.debug({ trackId: job.track_id, kind }, 'lyrics lookup');
      } catch (err) {
        if (stopped) return;
        const attempts = job.attempts + 1;
        if (err instanceof RetryableError && attempts <= BACKOFF.length) {
          const wait = Math.max(BACKOFF[attempts - 1], (err.retryAfterSeconds ?? 0) * 1000);
          store.retryLater(job.track_id, attempts, new Date(Date.now() + wait).toISOString(), err.message);
          log.info({ trackId: job.track_id, attempts, retryInMinutes: Math.round(wait / MINUTE) }, `lyrics lookup postponed: ${err.message}`);
        } else {
          store.saveLookup(job.track_id, { kind: 'missing' }, { onlyPending: true, error: err.message });
          log.warn({ trackId: job.track_id, err }, 'lyrics lookup failed');
        }
      }
      if (spacingMs) await sleep(spacingMs);
    }
  }

  function scheduleNext() {
    clearTimeout(timer);
    const at = !stopped && store.nextAttemptAt();
    if (!at) return;
    timer = setTimeout(kick, Math.min(Math.max(0, Date.parse(at) - Date.now()), 2 ** 31 - 1));
    timer.unref?.();
  }

  function kick() {
    if (stopped || running) return running;
    running = drain()
      .catch((err) => log.error({ err }, 'lyrics fetcher stopped unexpectedly'))
      .finally(() => {
        running = null;
        scheduleNext();
      });
    return running;
  }

  return {
    /** Queues a lookup for a new track and starts working on it. */
    queue(trackId) {
      store.queue(trackId);
      kick();
    },
    /** Asks LRCLIB right now (the "Search again" button). May throw RetryableError. */
    lookupNow: (trackId) => lookup(trackId, { onlyPending: false }),
    start: kick,
    /** Resolves once nothing is due; for tests and shutdown. */
    async idle() {
      while (running) await running;
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
