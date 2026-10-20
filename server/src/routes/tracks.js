import { httpError } from '../errors.js';
import { toApi } from '../library/tracks.js';

const idParams = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1 } },
  required: ['id'],
};

export default async function trackRoutes(app) {
  const { library } = app;

  app.get('/api/tracks', {
    schema: {
      querystring: {
        type: 'object',
        properties: { q: { type: 'string', maxLength: 200 } },
      },
    },
  }, async (request) => {
    return { tracks: library.list({ q: request.query.q }).map(toApi) };
  });

  app.get('/api/tracks/:id', { schema: { params: idParams } }, async (request) => {
    const track = library.get(request.params.id);
    if (!track) throw httpError(404, 'Track not found.');
    return toApi(track);
  });

  // Upload one song as multipart/form-data. The file is streamed to disk,
  // never buffered in memory, so large FLACs are fine.
  app.post('/api/tracks', async (request, reply) => {
    if (!request.isMultipart()) {
      throw httpError(415, 'Upload the song as multipart/form-data with a "file" field.');
    }
    const part = await request.file();
    if (!part) throw httpError(400, 'The upload has no file in it.');

    const { track, duplicate } = await library.ingest(part.file, part.filename);
    if (duplicate) {
      return reply.code(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'This song is already in your library.',
        track: toApi(track),
      });
    }
    return reply.code(201).header('location', `/api/tracks/${track.id}`).send(toApi(track));
  });

  app.delete('/api/tracks/:id', { schema: { params: idParams } }, async (request, reply) => {
    const track = await library.remove(request.params.id);
    if (!track) throw httpError(404, 'Track not found.');
    return reply.code(204).send();
  });
}
