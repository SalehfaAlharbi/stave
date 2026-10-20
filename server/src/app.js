import { mkdirSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { join } from 'node:path';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { openDatabase } from './db/index.js';
import { createLibrary } from './library/index.js';
import coverRoutes from './routes/covers.js';
import healthRoutes from './routes/health.js';
import trackRoutes from './routes/tracks.js';

/**
 * Builds the Fastify app without starting it, so tests can run it on a
 * random port against a throwaway data dir.
 */
export async function buildApp(config) {
  const app = Fastify({
    logger: config.logger ?? { level: config.logLevel },
    // On shutdown, drop open connections instead of waiting for keep-alive
    // timeouts or long audio streams to finish; players simply reconnect.
    forceCloseConnections: true,
  });

  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(join(config.dataDir, 'stave.db'));
  app.addHook('onClose', async () => db.close());

  const library = createLibrary({ db, dataDir: config.dataDir, maxUploadBytes: config.maxUploadBytes });
  await library.init();
  app.decorate('library', library);

  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, parts: 20 },
  });

  // One JSON error shape everywhere; details of server faults stay in the log.
  app.setErrorHandler((err, request, reply) => {
    const statusCode = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (statusCode >= 500) request.log.error(err);
    reply.code(statusCode).send({
      statusCode,
      error: STATUS_CODES[statusCode],
      message: statusCode >= 500 ? 'Something went wrong on the server.' : err.message,
    });
  });

  await app.register(healthRoutes);
  await app.register(trackRoutes);
  await app.register(coverRoutes);

  return app;
}
