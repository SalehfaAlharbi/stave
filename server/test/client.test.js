import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers.js';

const clientDir = fileURLToPath(new URL('../../client', import.meta.url));

describe('web client', () => {
  test('is served at / next to the API', async (t) => {
    const server = await startServer(t, { clientDir });

    const page = await server.fetch('/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(await page.text(), /<title>Stave<\/title>/);

    const script = await server.fetch('/src/main.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/, 'modules need a JavaScript MIME type');

    assert.equal((await server.json('/api/health')).body.status, 'ok');

    const favicon = await server.fetch('/favicon.ico', { redirect: 'manual' });
    assert.equal(favicon.status, 301);
    assert.equal(favicon.headers.get('location'), '/assets/icon.svg');
  });

  test('unknown API paths stay JSON 404s, and nothing outside the client folder is reachable', async (t) => {
    const server = await startServer(t, { clientDir });

    const missing = await server.json('/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.statusCode, 404);

    for (const path of ['/../server/package.json', '/%2e%2e/server/package.json', '/..%2fserver%2fpackage.json']) {
      const res = await server.fetch(path);
      assert.equal(res.status, 404, path);
    }
  });
});
