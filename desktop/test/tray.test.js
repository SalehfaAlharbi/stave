import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { makeMp3 } from '../../server/test/fixtures.js';
import { ADMIN, setUp, sleep } from './helpers.js';

async function signedInWithASong(t) {
  const it = await setUp(t);
  const server = await it.server();
  await server.upload(makeMp3({ seconds: 60, tags: { title: 'Stave tray test', artist: 'Stave Tests' } }), 'tray.mp3');
  const launched = await it.launch(await it.profile({ serverUrl: server.base }));
  const { window } = launched;
  await window.waitForSelector('#auth:not([hidden])');
  await window.fill('#auth-name', ADMIN.name);
  await window.fill('#auth-password', ADMIN.password);
  await window.click('#auth-submit');
  await window.waitForSelector('#tracklist .row');
  return launched;
}

const closeWindow = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
const exited = (app) => new Promise((resolve) => {
  if (app.process().exitCode !== null) resolve(app.process().exitCode);
  else app.process().once('exit', resolve);
});

describe('step 2: closing while music plays goes to the tray', () => {
  test('close while playing hides the window and the music keeps going; quitting really quits', async (t) => {
    const { app, window } = await signedInWithASong(t);
    await window.click('#tracklist .row >> nth=0');
    await window.waitForSelector('body.is-playing');
    await sleep(300); // let Electron report media-started-playing

    await closeWindow(app);
    await sleep(500);
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ destroyed: w.isDestroyed(), visible: w.isVisible() })));
    assert.deepEqual(after, [{ destroyed: false, visible: false }], 'the window is only hidden');
    assert.equal(await window.evaluate(() => document.body.classList.contains('is-playing')), true, 'still playing');

    // "Quit Stave" in the tray menu is app.quit().
    const exit = exited(app);
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    assert.equal(await exit, 0, 'the app is gone');
  });

  test('close while paused quits straight away', async (t) => {
    const { app, window } = await signedInWithASong(t);
    await window.click('#tracklist .row >> nth=0');
    await window.waitForSelector('body.is-playing');
    await window.click('#btn-play'); // pause
    await window.waitForSelector('body:not(.is-playing)');
    await sleep(300);

    const exit = exited(app);
    await closeWindow(app);
    assert.equal(await exit, 0);
  });
});
