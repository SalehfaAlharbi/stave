import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));

function intFromEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * Reads settings from environment variables.
 *
 * HOST defaults to 127.0.0.1 so a dev server is not reachable from the LAN
 * before login exists (phase 4). The Docker image sets HOST=0.0.0.0.
 */
export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: intFromEnv(env, 'PORT', 4545),
    dataDir: resolve(SERVER_ROOT, env.STAVE_DATA_DIR || 'data'),
    maxUploadBytes: intFromEnv(env, 'STAVE_MAX_UPLOAD_MB', 300) * 1024 * 1024,
    logLevel: env.LOG_LEVEL || 'info',
  };
}
