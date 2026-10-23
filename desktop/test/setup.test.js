import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { setUp, shot } from './helpers.js';


/** A port nothing is listening on (yet). */
async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const readSettings = (userData) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));

describe('step 2: choosing the server', () => {
  test('first launch asks for the address, suggesting the default', async (t) => {
    const it = await setUp(t);
    const { window } = await it.launch(await it.profile());

    await window.waitForSelector('body[data-ready]');
    assert.match(window.url(), /setup\.html$/);
    assert.equal(await window.inputValue('#address'), 'http://192.168.0.124:4545');
    assert.equal(await window.isHidden('#cancel'), true, 'nothing to go back to yet');
    await shot(window, 'step2-setup');
  });

  test('rejects addresses that are not a Stave server, then connects and remembers', async (t) => {
    const it = await setUp(t);
    const stave = await it.server({ signIn: false });
    const notStave = createServer((req, res) => res.writeHead(404).end('nope'));
    await new Promise((resolve) => notStave.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => notStave.close(resolve)));

    const userData = await it.profile();
    const first = await it.launch(userData);
    const { window } = first;
    await window.waitForSelector('body[data-ready]');

    const tryAddress = async (address) => {
      await window.fill('#address', address);
      await window.click('#connect');
      await window.waitForFunction(() => document.querySelector('#connect')?.textContent === 'Connect' || !document.querySelector('#connect'));
    };

    await tryAddress('not a url at all');
    assert.match(await window.textContent('#error'), /isn't a web address/);

    await tryAddress(`127.0.0.1:${await freePort()}`);
    assert.match(await window.textContent('#error'), /Couldn't reach/);

    await tryAddress(`127.0.0.1:${notStave.address().port}`);
    assert.match(await window.textContent('#error'), /isn't a Stave server/);
    await shot(window, 'step2-setup-error');

    // Typed without http://, like people do.
    await window.fill('#address', stave.base.replace('http://', ''));
    await window.click('#connect');
    await window.waitForSelector('#auth:not([hidden])');
    assert.equal(new URL(window.url()).origin, stave.base);
    assert.equal(readSettings(userData).serverUrl, stave.base);

    // The server page gets none of the setup calls.
    assert.equal(await window.evaluate(() => typeof window.staveSetup), 'undefined');

    // Next launch goes straight to the server.
    await first.close();
    const second = await it.launch(userData);
    await second.window.waitForSelector('#auth:not([hidden])');
    assert.equal(new URL(second.window.url()).origin, stave.base);
  });

  test("an unreachable server shows the \"can't reach Stave\" screen, which reconnects by itself", async (t) => {
    const it = await setUp(t);
    const port = await freePort();
    const address = `http://127.0.0.1:${port}`;
    const { window } = await it.launch(await it.profile({ serverUrl: address }));

    await window.waitForSelector('body[data-ready]');
    assert.match(window.url(), /unreachable\.html/);
    assert.equal(await window.textContent('#address'), address);
    await shot(window, 'step2-unreachable');

    // The server comes up on that address; within a few seconds the app is back.
    await it.server({ signIn: false, port });
    await window.waitForSelector('#auth:not([hidden])', { timeout: 15_000 });
    assert.equal(new URL(window.url()).origin, address);
  });

  test('"Change server" offers the current address and a way back', async (t) => {
    const it = await setUp(t);
    const { window } = await it.launch(await it.profile({ serverUrl: `http://127.0.0.1:${await freePort()}` }));
    await window.waitForSelector('body[data-ready]');
    await window.click('#change');
    await window.waitForURL(/setup\.html$/);
    await window.waitForSelector('body[data-ready]');
    assert.equal(await window.isVisible('#cancel'), true);
    assert.match(await window.inputValue('#address'), /^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
