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
    return { tracks: library.list({ q: request.query.q, userId: request.user.id }).map(toApi) };
  });

  app.get('/api/tracks/:id', { schema: { params: idParams } }, async (request) => {
    const track = library.get(request.params.id, request.user.id);
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

    const { track, duplicate } = await library.ingest(part.file, part.filename, { uploadedBy: request.user.id });
    if (duplicate) {
      return reply.code(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'This song is already in your library.',
        track: toApi(library.get(track.id, request.user.id)),
      });
    }
    return reply.code(201).header('location', `/api/tracks/${track.id}`).send(toApi(track));
  });

  // The library is shared, so only whoever added a song (or the admin) may delete it.
  app.delete('/api/tracks/:id', { schema: { params: idParams } }, async (request, reply) => {
    const track = library.get(request.params.id);
    if (!track) throw httpError(404, 'Track not found.');
    if (!request.user.isAdmin && track.uploaded_by !== request.user.id) {
      throw httpError(403, 'Only the person who added this song, or the admin, can delete it.');
    }
    await library.remove(track.id);
    return reply.code(204).send();
  });
}
