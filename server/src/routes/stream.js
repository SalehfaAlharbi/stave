import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { httpError } from '../errors.js';
import { etagMatches, parseRange, UNSATISFIABLE } from '../http/range.js';

const idParams = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1 } },
  required: ['id'],
};

export default async function streamRoutes(app) {
  const { library } = app;

  // Audio with HTTP range requests, so the player can start before the whole
  // file has arrived and can seek by asking for the bytes at a new offset.
  // HEAD is declared here rather than left to Fastify, whose automatic HEAD
  // route would read the whole file from disk just to discard it.
  app.route({
    method: ['GET', 'HEAD'],
    url: '/api/tracks/:id/stream',
    schema: { params: idParams },
    handler: streamTrack,
  });

  async function streamTrack(request, reply) {
    const track = library.get(request.params.id);
    if (!track) throw httpError(404, 'Track not found.');

    const path = library.audioFile(track);
    const info = await stat(path).catch(() => null);
    if (!info) {
      request.log.error({ trackId: track.id, path }, 'audio file is missing from disk');
      throw httpError(404, 'The audio file for this track is missing.');
    }

    // A track's file never changes (ids are not reused), so its content hash
    // is a strong ETag and the response can be cached for good.
    const etag = `"${track.file_hash}"`;
    const cacheHeaders = {
      'accept-ranges': 'bytes',
      etag,
      'cache-control': 'private, max-age=31536000, immutable',
    };

    if (etagMatches(request.headers['if-none-match'], etag)) {
      return reply.code(304).headers(cacheHeaders).send();
    }

    let range = parseRange(request.headers.range, info.size);
    // If-Range: only honour the range if the client's copy is this exact file.
    const ifRange = request.headers['if-range'];
    if (range && ifRange && ifRange.trim() !== etag) range = null;

    if (range === UNSATISFIABLE) {
      reply.header('content-range', `bytes */${info.size}`);
      throw httpError(416, 'The requested range is outside the file.');
    }

    const { start, end } = range ?? { start: 0, end: info.size - 1 };
    if (range) reply.code(206).header('content-range', `bytes ${start}-${end}/${info.size}`);
    reply.headers({
      ...cacheHeaders,
      'content-type': track.mime_type,
      'content-length': end - start + 1,
    });

    if (request.method === 'HEAD') return reply.send();
    return reply.send(createReadStream(path, { start, end }));
  }
}
