import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createLoginLimiter } from '../src/auth/plugin.js';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { makeMp3 } from './fixtures.js';
import { ADMIN, startServer } from './helpers.js';

const post = (body) => ({ method: 'POST', body });

describe('passwords', () => {
  test('are salted scrypt hashes that verify only the right password', async () => {
    const a = await hashPassword('hunter2-hunter2');
    const b = await hashPassword('hunter2-hunter2');
    assert.match(a, /^scrypt\$32768\$8\$1\$/);
    assert.notEqual(a, b, 'a new salt every time');
    assert.equal(await verifyPassword('hunter2-hunter2', a), true);
    assert.equal(await verifyPassword('hunter2-hunter3', a), false);
    assert.equal(await verifyPassword('anything', 'md5$nope'), false);
  });
});

describe('first-run setup', () => {
  test('needs the setup code from the log, then creates the admin and signs in', async (t) => {
    const server = await startServer(t, { signIn: false });
    const { anonymous: web, app } = server;

    const status = await web.json('/api/auth/status');
    assert.deepEqual(status.body, { user: null, setupRequired: true });
    assert.match(app.setup.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const wrong = await web.json('/api/auth/setup', post({ ...ADMIN, code: 'AAAA-BBBB-CCCC' }));
    assert.equal(wrong.status, 403);

    // Case, spaces and dashes don't matter.
    const typed = app.setup.code.toLowerCase().replace(/-/g, ' ');
    const ok = await web.json('/api/auth/setup', post({ ...ADMIN, code: typed }));
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body.user, { id: 1, name: 'admin', isAdmin: true });
    assert.ok(ok.cookie);

    const again = await web.json('/api/auth/setup', post({ name: 'intruder', password: 'longenough', code: typed }));
    assert.equal(again.status, 409, 'setup only works once');
    assert.equal(app.setup.code, null);
  });

  test('the session cookie is HttpOnly and SameSite=Lax', async (t) => {
    const server = await startServer(t, { signIn: false });
    const res = await server.anonymous.fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...ADMIN, code: server.app.setup.code }),
    });
    const cookie = res.headers.getSetCookie()[0];
    assert.match(cookie, /^stave_session=[\w-]{43};/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//);
  });

  test('rejects weak passwords and odd names', async (t) => {
    const server = await startServer(t, { signIn: false });
    const code = server.app.setup.code;
    assert.equal((await server.anonymous.json('/api/auth/setup', post({ name: 'me', password: 'short', code }))).status, 400);
    assert.equal((await server.anonymous.json('/api/auth/setup', post({ name: '<script>', password: 'longenough', code }))).status, 400);
  });
});

describe('signing in', () => {
  test('right password signs in, wrong password and unknown names do not', async (t) => {
    const server = await startServer(t);
    const web = server.anonymous;

    const ok = await web.json('/api/auth/login', post({ name: 'ADMIN', password: ADMIN.password }));
    assert.equal(ok.status, 200, 'names are case-insensitive');
    assert.equal(ok.body.user.name, 'admin');

    const wrong = await web.json('/api/auth/login', post({ name: 'admin', password: 'nope' }));
    assert.equal(wrong.status, 401);
    const unknown = await web.json('/api/auth/login', post({ name: 'ghost', password: 'nope' }));
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.message, wrong.body.message, 'no hint about which names exist');
  });

  test('locks out an address after too many wrong passwords', async (t) => {
    const server = await startServer(t, { loginLimiter: createLoginLimiter({ max: 3, windowMs: 60_000 }) });
    const web = server.anonymous;
    for (let i = 0; i < 3; i++) {
      assert.equal((await web.json('/api/auth/login', post({ name: 'admin', password: 'guess' }))).status, 401);
    }
    const blocked = await web.json('/api/auth/login', post({ name: 'admin', password: ADMIN.password }));
    assert.equal(blocked.status, 429, 'even the right password waits');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });

  test('signing out ends the session on the server', async (t) => {
    const server = await startServer(t);
    assert.equal((await server.json('/api/tracks')).status, 200);
    assert.equal((await server.json('/api/auth/logout', { method: 'POST' })).status, 204);
    assert.equal((await server.json('/api/tracks')).status, 401, 'the old cookie no longer works');
  });
});

describe('access', () => {
  test('the API needs a session; health and the auth endpoints do not', async (t) => {
    const server = await startServer(t);
    const { body: track } = await server.upload(makeMp3({ seconds: 3, tags: { title: 'Private' } }), 'a.mp3');
    const web = server.anonymous;

    for (const path of ['/api/tracks', `/api/tracks/${track.id}`, track.streamUrl, '/api/likes', '/api/playlists']) {
      assert.equal((await web.fetch(path)).status, 401, path);
    }
    assert.equal((await web.upload(makeMp3({ seconds: 2 }), 'b.mp3')).status, 401);

    const health = await web.json('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.tracks, undefined, 'library size only for signed-in users');
    assert.equal((await server.json('/api/health')).body.tracks, 1);
    assert.equal((await web.json('/api/auth/status')).status, 200);
  });

  test('refuses requests that change something when they come from another site', async (t) => {
    const server = await startServer(t);
    const evil = await server.json('/api/playlists', {
      method: 'POST', body: { name: 'pwned' }, headers: { origin: 'https://evil.example' },
    });
    assert.equal(evil.status, 403);
    const same = await server.json('/api/playlists', {
      method: 'POST', body: { name: 'mine' }, headers: { origin: server.base },
    });
    assert.equal(same.status, 201);
  });
});

describe('invites', () => {
  test('the admin invites; the link works once and signs the new user in', async (t) => {
    const server = await startServer(t);
    const invite = await server.json('/api/invites', { method: 'POST' });
    assert.equal(invite.status, 201);
    assert.equal(invite.body.url, `/?invite=${invite.body.code}`);

    const web = server.anonymous;
    assert.deepEqual((await web.json(`/api/invites/${invite.body.code}`)).body.invitedBy, 'admin');

    const joined = await web.json('/api/auth/register', post({ code: invite.body.code, name: 'Sam', password: 'sams-password' }));
    assert.equal(joined.status, 201);
    assert.deepEqual(joined.body.user, { id: 2, name: 'Sam', isAdmin: false });

    const reused = await web.json('/api/auth/register', post({ code: invite.body.code, name: 'Eve', password: 'eves-password' }));
    assert.equal(reused.status, 404);
    assert.equal((await web.json(`/api/invites/${invite.body.code}`)).status, 404);
  });

  test('a taken name is refused and the invite stays usable', async (t) => {
    const server = await startServer(t);
    const { body: { code } } = await server.json('/api/invites', { method: 'POST' });
    const taken = await server.anonymous.json('/api/auth/register', post({ code, name: 'Admin', password: 'longenough' }));
    assert.equal(taken.status, 409);
    const ok = await server.anonymous.json('/api/auth/register', post({ code, name: 'Robin', password: 'longenough' }));
    assert.equal(ok.status, 201);
  });

  test('only the admin can invite', async (t) => {
    const server = await startServer(t);
    const sam = await server.addUser('Sam');
    assert.equal((await sam.json('/api/invites', { method: 'POST' })).status, 403);
  });
});
