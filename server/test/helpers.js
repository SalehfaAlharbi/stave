import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

export const ADMIN = { name: 'admin', password: 'correct horse battery' };

function sessionCookie(res) {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('stave_session='));
  return cookie ? cookie.split(';')[0] : null;
}

/** fetch helpers that send one user's session cookie (or none). */
function clientFor(base, cookie) {
  const withCookie = (init = {}) => ({
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const client = {
    cookie,
    fetch: (path, init) => fetch(base + path, withCookie(init)),
    async json(path, init = {}) {
      const options = { ...init };
      if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
        options.body = JSON.stringify(init.body);
        options.headers = { 'content-type': 'application/json', ...(init.headers ?? {}) };
      }
      const res = await fetch(base + path, withCookie(options));
      const text = await res.text();
      return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, cookie: sessionCookie(res) };
    },
    async upload(buffer, filename) {
      const form = new FormData();
      form.append('file', new Blob([buffer]), filename);
      const res = await fetch(`${base}/api/tracks`, withCookie({ method: 'POST', body: form }));
      return { status: res.status, headers: res.headers, body: await res.json() };
    },
  };
  return client;
}

/**
 * Starts a real server on a random port with its own empty data dir, and
 * removes both when the test ends. By default it creates the admin account
 * with the setup code and every request is signed in as the admin; pass
 * { signIn: false } to start signed out.
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

  const anonymous = clientFor(base, null);
  let cookie = null;
  if (overrides.signIn !== false) {
    const res = app.setup.code
      ? await anonymous.json('/api/auth/setup', { method: 'POST', body: { ...ADMIN, code: app.setup.code } })
      : await anonymous.json('/api/auth/login', { method: 'POST', body: { name: ADMIN.name, password: ADMIN.password } });
    if (!res.cookie) throw new Error(`test sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
    cookie = res.cookie;
  }

  const server = {
    app,
    dataDir,
    base,
    ...clientFor(base, cookie),
    anonymous,
    files: (dir) => readdir(join(dataDir, dir)),

    /** Creates another account through an admin invite and returns a client signed in as it. */
    async addUser(name, password = `${name}-password-123`) {
      const invite = await server.json('/api/invites', { method: 'POST' });
      const res = await anonymous.json('/api/auth/register', { method: 'POST', body: { code: invite.body.code, name, password } });
      if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
      return { ...clientFor(base, res.cookie), user: res.body.user };
    },
  };
  return server;
}
