import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

/**
 * Starts a real server on a random port with its own empty data dir, and
 * removes both when the test ends.
 */
export async function startServer(t, overrides = {}) {
  const dataDir = overrides.dataDir ?? (await mkdtemp(join(tmpdir(), 'stave-test-')));
  const app = await buildApp({ maxUploadBytes: 10 * 1024 * 1024, logger: false, ...overrides, dataDir });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`;

  t.after(async () => {
    await app.close();
    if (!overrides.keepDataDir) await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  });

  return {
    app,
    dataDir,
    base,
    fetch: (path, init) => fetch(base + path, init),
    async json(path, init) {
      const res = await fetch(base + path, init);
      return { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() };
    },
    async upload(buffer, filename) {
      const form = new FormData();
      form.append('file', new Blob([buffer]), filename);
      const res = await fetch(`${base}/api/tracks`, { method: 'POST', body: form });
      return { status: res.status, headers: res.headers, body: await res.json() };
    },
    files: (dir) => readdir(join(dataDir, dir)),
  };
}
