import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { makeMp3 } from './fixtures.js';
import { startServer } from './helpers.js';

// Made-up lines, standing in for what LRCLIB returns.
const SYNCED = '[00:01.00] First line\n[00:03.50] Second line\n[00:06.00]\n[00:07.25] Third line';
const PLAIN = 'First line\nSecond line\n\nThird line';

/**
 * A stand-in for lrclib.net. `answer(params)` returns { status, body,
 * headers } or a promise of one; every request is recorded.
 */
async function fakeLrclib(t, answer) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://lrclib.test');
    const params = Object.fromEntries(url.searchParams);
    requests.push({ path: url.pathname, params, userAgent: req.headers['user-agent'] });
    const { status = 200, body = {}, headers = {} } = (await answer(params)) ?? { status: 404 };
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

const found = (params) => ({
  body: { id: 42, trackName: params.track_name, artistName: params.artist_name, duration: Number(params.duration), instrumental: false, syncedLyrics: SYNCED, plainLyrics: PLAIN },
});

async function upload(server, tags, seconds = 30) {
  const { status, body } = await server.upload(makeMp3({ seconds, tags }), `${tags.title ?? 'untitled'}.mp3`);
  assert.equal(status, 201);
  await server.app.lyrics.fetcher?.idle();
  return body;
}

const lyricsOf = async (server, track) => (await server.json(`/api/tracks/${track.id}/lyrics`)).body;

function lyricsRow(server, trackId) {
  const db = new DatabaseSync(join(server.dataDir, 'stave.db'), { readOnly: true });
  try {
    return db.prepare('SELECT * FROM lyrics WHERE track_id = ?').get(trackId);
  } finally {
    db.close();
  }
}

describe('looking up lyrics on LRCLIB', () => {
  test('an upload is looked up by title, artist, album and length, and synced lyrics are stored', async (t) => {
    const lrclib = await fakeLrclib(t, found);
    const server = await startServer(t, { lrclibUrl: lrclib.url, lyricsSpacingMs: 0 });

    const track = await upload(server, { title: 'Synced Song', artist: 'Test Artist', album: 'Test Album' });
    const lyrics = await lyricsOf(server, track);

    assert.equal(lyrics.status, 'found');
    assert.equal(lyrics.source, 'lrclib');
    assert.equal(lyrics.synced, true);
    assert.deepEqual(lyrics.lines.map((l) => l.time), [1, 3.5, 6, 7.25]);
    assert.equal(lyrics.lines[2].text, '', 'an instrumental gap');
    assert.equal(lyrics.text, SYNCED, 'the raw LRC, for the editor');

    assert.equal(lrclib.requests.length, 1);
    assert.deepEqual(lrclib.requests[0].params, {
      track_name: 'Synced Song', artist_name: 'Test Artist', album_name: 'Test Album', duration: '30',
    });
    assert.match(lrclib.requests[0].userAgent, /^Stave\/\d+\.\d+\.\d+ /, 'identifies itself, as LRCLIB asks');
  });

  test('a miss with the album is retried without it, then the song is marked missing', async (t) => {
    const lrclib = await fakeLrclib(t, () => ({ status: 404, body: { message: 'not found' } }));
    const server = await startServer(t, { lrclibUrl: lrclib.url, lyricsSpacingMs: 0 });

    const track = await upload(server, { title: 'Unknown', artist: 'Nobody', album: 'Deluxe Edition' });

    assert.deepEqual(lrclib.requests.map((r) => 'album_name' in r.params), [true, false]);
    assert.equal((await lyricsOf(server, track)).status, 'missing');
  });

  test('instrumentals are remembered as such', async (t) => {
    const lrclib = await fakeLrclib(t, () => ({ body: { id: 7, instrumental: true, syncedLyrics: null, plainLyrics: null } }));
    const server = await startServer(t, { lrclibUrl: lrclib.url, lyricsSpacingMs: 0 });
    const track = await upload(server, { title: 'No Words', artist: 'Band' });
    assert.equal((await lyricsOf(server, track)).status, 'instrumental');
  });

  test('plain-only lyrics are stored unsynced', async (t) => {
    const lrclib = await fakeLrclib(t, () => ({ body: { id: 8, instrumental: false, syncedLyrics: null, plainLyrics: PLAIN } }));
    const server = await startServer(t, { lrclibUrl: lrclib.url, lyricsSpacingMs: 0 });
    const lyrics = await lyricsOf(server, await upload(server, { title: 'Words', artist: 'Band' }));
    assert.equal(lyrics.synced, false);
    assert.deepEqual(lyrics.lines.map((l) => l.text), ['First line', 'Second line', '', 'Third line']);
    assert.ok(lyrics.lines.every((l) => l.time === null));
  });

  test('when LRCLIB is busy the song stays queued and is retried later', async (t) => {
    let busy = true;
    const lrclib = await fakeLrclib(t, (params) => (busy
      ? { status: 503, body: { message: 'The server is busy, please retry in a moment', name: 'ServerOverloaded' } }
      : found(params)));
    const server = await startServer(t, { lrclibUrl: lrclib.url, lyricsSpacingMs: 0 });

    const track = await upload(server, { title: 'Busy Song', artist: 'Band' });
    assert.equal((await lyricsOf(server, track)).status, 'pending');
    const row = lyricsRow(server, track.id);
    assert.equal(row.attempts, 1);
    assert.match(row.last_error, /503/);
    const waitMinutes = (Date.parse(row.next_attempt_at) - Date.now()) / 60_000;
    assert.ok(waitMinutes > 0.9 && waitMinutes <= 1, `next try in about a minute, got ${waitMinutes}`);

    // "Search again" while still busy says so...
    const stillBusy = await server.json(`/api/tracks/${track.id}/lyrics/lookup`, { method: 'POST' });
    assert.equal(stillBusy.status, 503);
    // ...and works once LRCLIB is back.
    busy = false;
    const later = await server.json(`/api/tracks/${track.id}/lyrics/lookup`, { method: 'POST' });
    assert.equal(later.status, 200);
    assert.equal(later.body.status, 'found');
  });

  test('songs without an artist are not sent to LRCLIB', async (t) => {
    const lrclib = await fakeLrclib(t, found);
    const server = await startServer(t, { lrclibUrl: lrclib.url, lyricsSpacingMs: 0 });
    const track = await upload(server, {}, 5); // no tags, no "Artist - Title" in the file name
    assert.equal(lrclib.requests.length, 0);
    assert.equal((await lyricsOf(server, track)).status, 'missing');
  });
});

describe('lyrics typed in by hand', () => {
  test('pasted LRC becomes synced lyrics, anything else plain', async (t) => {
    const server = await startServer(t);
    const track = await upload(server, { title: 'Mine', artist: 'Me' });
    assert.equal((await lyricsOf(server, track)).status, 'missing', 'lookups are off in this test');

    const synced = await server.json(`/api/tracks/${track.id}/lyrics`, { method: 'PUT', body: { text: `${SYNCED}\r\n` } });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.source, 'manual');
    assert.equal(synced.body.synced, true);
    assert.equal(synced.body.lines.length, 4);

    const plain = await server.json(`/api/tracks/${track.id}/lyrics`, { method: 'PUT', body: { text: 'Hum hum\n[Chorus]\nla la' } });
    assert.equal(plain.body.synced, false);
    assert.deepEqual(plain.body.lines.map((l) => l.text), ['Hum hum', '[Chorus]', 'la la']);

    assert.equal((await server.json(`/api/tracks/${track.id}/lyrics`, { method: 'PUT', body: { text: '   ' } })).status, 400);

    const removed = await server.json(`/api/tracks/${track.id}/lyrics`, { method: 'DELETE' });
    assert.equal(removed.body.status, 'missing');
    assert.deepEqual(removed.body.lines, []);
  });

  test('a lookup that finishes after a hand edit does not overwrite it', async (t) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const lrclib = await fakeLrclib(t, async (params) => {
      await gate;
      return found(params);
    });
    const server = await startServer(t, { lrclibUrl: lrclib.url, lyricsSpacingMs: 0 });
    const { body: track } = await server.upload(makeMp3({ seconds: 20, tags: { title: 'Race', artist: 'Band' } }), 'race.mp3');

    // The lookup is waiting on LRCLIB; meanwhile someone pastes their own.
    await server.json(`/api/tracks/${track.id}/lyrics`, { method: 'PUT', body: { text: 'My own words' } });
    release();
    await server.app.lyrics.fetcher.idle();

    const lyrics = await lyricsOf(server, track);
    assert.equal(lyrics.source, 'manual');
    assert.deepEqual(lyrics.lines.map((l) => l.text), ['My own words']);
  });

  test('"Search again" keeps hand-made lyrics when LRCLIB still has nothing', async (t) => {
    const lrclib = await fakeLrclib(t, () => ({ status: 404 }));
    const server = await startServer(t, { lrclibUrl: lrclib.url, lyricsSpacingMs: 0 });
    const track = await upload(server, { title: 'Obscure', artist: 'Band' });
    await server.json(`/api/tracks/${track.id}/lyrics`, { method: 'PUT', body: { text: 'Hand made' } });

    const after = await server.json(`/api/tracks/${track.id}/lyrics/lookup`, { method: 'POST' });
    assert.equal(after.body.source, 'manual');
    assert.equal(after.body.lines[0].text, 'Hand made');
  });

  test('with lookups off, "Search again" explains why it can\'t', async (t) => {
    const server = await startServer(t);
    const track = await upload(server, { title: 'Offline', artist: 'Band' });
    const res = await server.json(`/api/tracks/${track.id}/lyrics/lookup`, { method: 'POST' });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /turned off/);
  });

  test('lyrics need a session and go away with their track', async (t) => {
    const server = await startServer(t);
    const track = await upload(server, { title: 'Gone Soon', artist: 'Band' });
    await server.json(`/api/tracks/${track.id}/lyrics`, { method: 'PUT', body: { text: SYNCED } });

    assert.equal((await server.anonymous.json(`/api/tracks/${track.id}/lyrics`)).status, 401);
    await server.json(`/api/tracks/${track.id}`, { method: 'DELETE' });
    assert.equal((await server.json(`/api/tracks/${track.id}/lyrics`)).status, 404);
    assert.equal(lyricsRow(server, track.id), undefined);
  });
});
