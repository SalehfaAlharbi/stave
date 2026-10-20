import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { httpError } from '../errors.js';

const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

export default async function coverRoutes(app) {
  const { library } = app;

  // Cover URLs are named by the image's hash, so a URL's content never
  // changes and browsers can cache it forever. "private" keeps shared
  // caches (a tunnel or CDN) from storing someone's library.
  app.get('/api/covers/:name', async (request, reply) => {
    const path = library.coverFile(request.params.name);
    const info = path && (await stat(path).catch(() => null));
    if (!info) throw httpError(404, 'Cover not found.');

    return reply
      .header('content-type', MIME[extname(path)])
      .header('content-length', info.size)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(createReadStream(path));
  });
}
