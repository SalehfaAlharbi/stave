import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { makeFlac, makeMp3, makeWav, PNG_1PX } from './fixtures.js';
import { startServer } from './helpers.js';

const TAGS = {
  title: 'Café del Mar — 東京',
  artist: 'Stave Test Band',
  album: 'Fixtures Vol. 1',
  year: 2024,
  track: '3/12',
  cover: PNG_1PX,
};

describe('POST /api/tracks', () => {
  test('stores a tagged MP3 and reads its tags and cover', async (t) => {
    const server = await startServer(t);
    const mp3 = makeMp3({ seconds: 10, tags: TAGS });

    const res = await server.upload(mp3, 'whatever-name.mp3');

    assert.equal(res.status, 201);
    const track = res.body;
    assert.equal(res.headers.get('location'), `/api/tracks/${track.id}`);
    assert.equal(track.title, TAGS.title);
    assert.equal(track.artist, TAGS.artist);
    assert.equal(track.album, TAGS.album);
    assert.equal(track.year, 2024);
    assert.equal(track.trackNo, 3);
    assert.ok(Math.abs(track.duration - 10) < 0.05, `duration ${track.duration}`);
    assert.equal(track.mimeType, 'audio/mpeg');
    assert.equal(track.fileSize, mp3.length);
    assert.match(track.coverUrl, /^\/api\/covers\/[a-f0-9]{64}\.png$/);

    // The audio is stored byte-for-byte under its content hash.
    const [stored] = await server.files('music');
    assert.match(stored, /^[a-f0-9]{64}\.mp3$/);
    assert.deepEqual(await readFile(join(server.dataDir, 'music', stored)), mp3);
    assert.deepEqual(await server.files('tmp'), []);
  });

  test('serves the extracted cover with long-lived caching', async (t) => {
    const server = await startServer(t);
    const { body: track } = await server.upload(makeMp3({ tags: TAGS }), 'a.mp3');

    const res = await server.fetch(track.coverUrl);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG_1PX);
  });

  test('reads WAV (RIFF INFO) and FLAC (Vorbis comments) too', async (t) => {
    const server = await startServer(t);

    const wav = await server.upload(makeWav({ seconds: 2, tags: { title: 'Wave Song', artist: 'W', album: 'WA' } }), 'x.wav');
    assert.equal(wav.status, 201);
    assert.equal(wav.body.mimeType, 'audio/wav');
    assert.equal(wav.body.title, 'Wave Song');
    assert.equal(wav.body.duration, 2);

    const flac = await server.upload(makeFlac({ seconds: 3, tags: { title: 'Flac Song', artist: 'F', year: '2019' }, cover: PNG_1PX }), 'x.flac');
    assert.equal(flac.status, 201);
    assert.equal(flac.body.mimeType, 'audio/flac');
    assert.equal(flac.body.title, 'Flac Song');
    assert.equal(flac.body.year, 2019);
    assert.equal(flac.body.duration, 3);
    assert.ok(flac.body.coverUrl);
  });

  test('stores the format it detected, not the one the file name claims', async (t) => {
    const server = await startServer(t);
    const res = await server.upload(makeWav({ tags: { title: 'Secretly a WAV' } }), 'song.mp3');
    assert.equal(res.status, 201);
    assert.equal(res.body.mimeType, 'audio/wav');
    assert.match((await server.files('music'))[0], /\.wav$/);
  });

  test('falls back to the file name when there are no tags', async (t) => {
    const server = await startServer(t);
    const res = await server.upload(makeMp3({ seconds: 4 }), '07. Daft Punk - Get Lucky.mp3');
    assert.equal(res.status, 201);
    assert.equal(res.body.title, 'Get Lucky');
    assert.equal(res.body.artist, 'Daft Punk');
    assert.equal(res.body.album, null);
    assert.equal(res.body.coverUrl, null);
  });

  test('rejects an exact duplicate with 409 and points at the existing track', async (t) => {
    const server = await startServer(t);
    const mp3 = makeMp3({ tags: TAGS });

    const first = await server.upload(mp3, 'a.mp3');
    const second = await server.upload(mp3, 'renamed copy.mp3');

    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.equal(second.body.track.id, first.body.id);
    assert.equal((await server.files('music')).length, 1);
    assert.deepEqual(await server.files('tmp'), []);
  });

  test('tracks from the same album share one cover file', async (t) => {
    const server = await startServer(t);
    const a = await server.upload(makeMp3({ seconds: 3, tags: { ...TAGS, title: 'One' } }), 'a.mp3');
    const b = await server.upload(makeMp3({ seconds: 4, tags: { ...TAGS, title: 'Two' } }), 'b.mp3');
    assert.equal(a.body.coverUrl, b.body.coverUrl);
    assert.equal((await server.files('covers')).length, 1);
  });

  test('rejects a file that is not audio, whatever its name, and leaves nothing behind', async (t) => {
    const server = await startServer(t);
    const res = await server.upload(Buffer.from('definitely not a song\n'.repeat(100)), 'notes.mp3');

    assert.equal(res.status, 415);
    assert.match(res.body.message, /not an audio format/);
    assert.deepEqual(await server.files('music'), []);
    assert.deepEqual(await server.files('tmp'), []);
  });

  test('rejects files over the size limit with 413', async (t) => {
    const server = await startServer(t, { maxUploadBytes: 20_000 });
    const res = await server.upload(makeMp3({ seconds: 5 }), 'big.mp3'); // about 80 KB

    assert.equal(res.status, 413);
    assert.deepEqual(await server.files('music'), []);
    assert.deepEqual(await server.files('tmp'), []);
  });

  test('requires a multipart body with a file in it', async (t) => {
    const server = await startServer(t);

    const json = await server.json('/api/tracks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(json.status, 415);

    const form = new FormData();
    form.append('title', 'no file here');
    const empty = await server.json('/api/tracks', { method: 'POST', body: form });
    assert.equal(empty.status, 400);
  });
});

describe('startup', () => {
  test('clears uploads left half-finished by a crash', async (t) => {
    const first = await startServer(t, { keepDataDir: true });
    await first.app.close();
    const leftover = join(first.dataDir, 'tmp', 'interrupted-upload');
    await writeFile(leftover, 'partial');

    const second = await startServer(t, { dataDir: first.dataDir });
    await assert.rejects(stat(leftover), { code: 'ENOENT' });
    assert.deepEqual(await second.files('tmp'), []);
  });
});
