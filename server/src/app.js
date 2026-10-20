import { randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { join } from 'node:path';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { createLoginLimiter, setupAuth } from './auth/plugin.js';
import { createAuthStore } from './auth/store.js';
import { openDatabase } from './db/index.js';
import { createCollections } from './library/collections.js';
import { createLibrary } from './library/index.js';
import authRoutes from './routes/auth.js';
import collectionRoutes from './routes/collections.js';
import coverRoutes from './routes/covers.js';
import healthRoutes from './routes/health.js';
import streamRoutes from './routes/stream.js';
import trackRoutes from './routes/tracks.js';

// No 0/O or 1/I/L, so the code survives being read out of a terminal.
const SETUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newSetupCode() {
  const chars = Array.from({ length: 12 }, () => SETUP_ALPHABET[randomInt(SETUP_ALPHABET.length)]);
  return chars.join('').replace(/(.{4})(?!$)/g, '$1-');
}

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
    // Behind a tunnel or reverse proxy, take the client address and protocol
    // from X-Forwarded-* (for the login limiter and Secure cookies).
    trustProxy: config.trustProxy ?? false,
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

  // Accounts. On a fresh install, a one-time setup code goes to the log, so
  // only someone with access to the server can create the admin account.
  const store = createAuthStore(db);
  store.pruneSessions();
  const setup = { code: store.userCount() === 0 ? (config.setupCode ?? newSetupCode()) : null };
  app.decorate('setup', setup);
  if (setup.code) {
    app.log.warn(`No accounts yet. Open Stave in a browser and create the admin account with setup code ${setup.code}`);
  }
  await setupAuth(app, { store });

  await app.register(healthRoutes);
  await app.register(authRoutes, { store, setup, limiter: config.loginLimiter ?? createLoginLimiter() });
  await app.register(trackRoutes);
  await app.register(collectionRoutes, { collections: createCollections(db) });
  await app.register(streamRoutes);
  await app.register(coverRoutes);

  // The web client, from the same origin as the API: no CORS, and the
  // service worker (phase 7) can cover the whole app. Files are revalidated
  // on every load (ETag), so a deploy shows up on the next refresh.
  if (config.clientDir) {
    await app.register(fastifyStatic, { root: config.clientDir, maxAge: 0 });
    // Browsers ask for /favicon.ico even when the page declares an SVG icon.
    app.get('/favicon.ico', (request, reply) => reply.redirect('/assets/icon.svg', 301));
  }

  return app;
}
