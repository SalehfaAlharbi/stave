import { httpError } from '../errors.js';
import { RetryableError } from '../lyrics/lrclib.js';
import { toApiLyrics } from '../lyrics/store.js';

const params = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

/**
 * Lyrics are part of the shared library, so anyone signed in can fix them;
 * an edit can always be undone with "Search LRCLIB again".
 */
export default async function lyricsRoutes(app, { store, fetcher }) {
  const { library } = app;

  function trackOr404(request) {
    const track = library.get(request.params.id);
    if (!track) throw httpError(404, 'Track not found.');
    return track;
  }

  app.get('/api/tracks/:id/lyrics', { schema: { params } }, async (request) => {
    const track = trackOr404(request);
    return toApiLyrics(store.get(track.id));
  });

  app.put('/api/tracks/:id/lyrics', {
    schema: {
      params,
      body: {
        type: 'object',
        required: ['text'],
        additionalProperties: false,
        properties: { text: { type: 'string', maxLength: 100_000 } },
      },
    },
  }, async (request) => {
    const track = trackOr404(request);
    const text = request.body.text.replace(/\r\n?/g, '\n').trim();
    if (!text) throw httpError(400, 'Paste some lyrics first, or remove them instead.');
    store.saveManual(track.id, text);
    return toApiLyrics(store.get(track.id));
  });

  app.delete('/api/tracks/:id/lyrics', { schema: { params } }, async (request) => {
    const track = trackOr404(request);
    store.clear(track.id);
    return toApiLyrics(store.get(track.id));
  });

  // "Search LRCLIB again": asks now and waits for the answer. Lyrics someone
  // typed in stay if LRCLIB still has nothing.
  app.post('/api/tracks/:id/lyrics/lookup', { schema: { params } }, async (request) => {
    const track = trackOr404(request);
    if (!fetcher) throw httpError(409, 'Looking up lyrics online is turned off on this server.');
    const before = store.get(track.id);
    try {
      const kind = await fetcher.lookupNow(track.id);
      if (kind === 'missing' && before?.source === 'manual') store.saveManual(track.id, before.synced ?? before.plain);
    } catch (err) {
      if (!(err instanceof RetryableError)) throw err;
      throw httpError(503, "LRCLIB is busy right now. Try again in a few minutes.");
    }
    return toApiLyrics(store.get(track.id));
  });
}
