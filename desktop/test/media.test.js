import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeMp3 } from '../../server/test/fixtures.js';
import { ADMIN, setUp, sleep } from './helpers.js';

const SMTC = fileURLToPath(new URL('./smtc.ps1', import.meta.url));
// A title no real song has, so only this test's session is ever touched.
const PREFIX = 'Stave media test';

/** Asks Windows' system media controls about (or sends a button press to) this test's session. */
function smtc(action = 'list') {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SMTC, '-Title', PREFIX, '-Action', action], { encoding: 'utf8' });
  return JSON.parse(out);
}

async function until(check, what, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

/** A signed-in app playing the first of two silent test songs. */
async function playing(t) {
  const it = await setUp(t);
  const server = await it.server();
  for (const [i, title] of [`${PREFIX} two`, `${PREFIX} one`].entries()) {
    const tags = { title, artist: 'Stave Tests', album: 'Media Keys' };
    assert.equal((await server.upload(makeMp3({ seconds: 40 + i, tags }), `${i}.mp3`)).status, 201);
  }
  const { app, window } = await it.launch(await it.profile({ serverUrl: server.base }));
  await window.waitForSelector('#auth:not([hidden])');
  await window.fill('#auth-name', ADMIN.name);
  await window.fill('#auth-password', ADMIN.password);
  await window.click('#auth-submit');
  await window.waitForSelector('#tracklist .row');
  await window.click('#tracklist .row >> nth=0'); // newest first: "one"
  await window.waitForSelector('body.is-playing');
  return { app, window };
}

const nowPlaying = (window) => window.textContent('#player-title');
const isPlaying = (window) => window.evaluate(() => document.body.classList.contains('is-playing'));

describe('step 2: media keys reach Stave through Windows media controls', { skip: process.platform !== 'win32' }, () => {
  test('Windows lists Stave with the song, and its buttons control the player', async (t) => {
    const { window } = await playing(t);

    const listed = await until(() => {
      const s = smtc();
      return s.found && s.status === 'Playing' && s;
    }, 'Stave to show up as playing in Windows media controls');
    assert.equal(listed.title, `${PREFIX} one`);
    assert.equal(listed.artist, 'Stave Tests');
    assert.equal(listed.album, 'Media Keys');
    assert.equal(listed.app, 'com.saleh.stave');

    // Play/pause, as the media key sends it while the window is hidden.
    assert.equal(smtc('toggle').accepted, true);
    await until(async () => !(await isPlaying(window)), 'the player to pause');
    await until(() => smtc().status === 'Paused', 'Windows to show it paused');

    assert.equal(smtc('toggle').accepted, true);
    await until(() => isPlaying(window), 'the player to play again');

    // Next and previous.
    assert.equal(smtc('next').accepted, true);
    await until(async () => (await nowPlaying(window)) === `${PREFIX} two`, 'the next song');
    await until(() => smtc().title === `${PREFIX} two`, 'Windows to show the next song');
    assert.equal(smtc('previous').accepted, true);
    await until(async () => (await nowPlaying(window)) === `${PREFIX} one`, 'the previous song');
  });
});
