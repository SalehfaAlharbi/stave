import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { setUp, shot, sleep, windowState } from './helpers.js';

describe('step 1: the window loads the Stave server', () => {
  test('opens a 1280x800 window showing the configured server', async (t) => {
    const it = await setUp(t);
    const server = await it.server({ signIn: false });
    const { app, window } = await it.launch(await it.profile({ serverUrl: server.base }));

    await window.waitForSelector('#auth:not([hidden])');
    assert.equal(new URL(window.url()).origin, server.base);
    assert.equal(await window.title(), 'Stave');
    const state = await windowState(app);
    assert.equal(state.width, 1280);
    assert.equal(state.height, 800);
    await shot(window, 'step1-window');
  });

  test('the page gets no Node.js, and links away from the server go to the browser instead', async (t) => {
    const it = await setUp(t);
    const server = await it.server({ signIn: false });
    const { app, window } = await it.launch(await it.profile({ serverUrl: server.base }));
    await window.waitForSelector('#auth:not([hidden])');

    assert.equal(await window.evaluate(() => typeof require), 'undefined');
    assert.equal(await window.evaluate(() => typeof process), 'undefined');

    // Count real calls to the OS browser handler: in test mode there must be none.
    await app.evaluate(({ shell }) => {
      globalThis.realOpenExternalCalls = 0;
      shell.openExternal = async () => { globalThis.realOpenExternalCalls += 1; };
    });

    await window.evaluate(() => { location.href = 'http://example.invalid/'; }); // a navigation
    await window.evaluate(() => { window.open('https://lrclib.net/', '_blank'); }); // a new-window link, like the LRCLIB credit
    await sleep(500);

    assert.equal(new URL(window.url()).origin, server.base, 'still on the Stave server');
    const { opened, realCalls } = await app.evaluate(() => ({
      opened: globalThis.staveTest.openedExternally,
      realCalls: globalThis.realOpenExternalCalls,
    }));
    assert.deepEqual(opened, ['http://example.invalid/', 'https://lrclib.net/'], 'both were handed to the browser handler');
    assert.equal(realCalls, 0, 'and no real browser was opened');
    assert.equal(app.windows().length, 1, 'no second Electron window either');
  });

  test('a second launch exits and leaves the first window alone', async (t) => {
    const it = await setUp(t);
    const server = await it.server({ signIn: false });
    const userData = await it.profile({ serverUrl: server.base });
    const { app } = await it.launch(userData);

    const second = spawnSync(electronPath, ['.'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, STAVE_DESKTOP_USER_DATA: userData, STAVE_DESKTOP_HIDDEN: '1' },
      timeout: 20_000,
    });
    assert.equal(second.status, 0, 'the second instance quit on its own');
    assert.equal(app.windows().length, 1);
  });
});
