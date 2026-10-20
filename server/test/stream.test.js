import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { etagMatches, parseRange, UNSATISFIABLE } from '../src/http/range.js';
import { makeMp3, makeWav, MP3_FRAME_SECONDS } from './fixtures.js';
import { startServer } from './helpers.js';

describe('parseRange', () => {
  const size = 1000;
  const cases = [
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=500-', { start: 500, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }], // suffix longer than the file
    ['bytes=900-5000', { start: 900, end: 999 }], // end past the file is clamped
    ['bytes=999-999', { start: 999, end: 999 }],
    ['bytes=1000-', UNSATISFIABLE],
    ['bytes=1000-2000', UNSATISFIABLE],
    ['bytes=-0', UNSATISFIABLE],
    [undefined, null],
    ['bytes=500-100', null], // backwards: ignored, whole file sent
    ['bytes=0-1,5-9', null], // several ranges: ignored
    ['items=0-99', null],
    ['bytes=-', null],
    ['bytes=abc-def', null],
  ];
  for (const [header, expected] of cases) {
    test(String(header), () => assert.deepEqual(parseRange(header, size), expected));
  }
});

describe('etagMatches', () => {
  test('handles lists, weak tags and *', () => {
    assert.ok(etagMatches('"abc"', '"abc"'));
    assert.ok(etagMatches('"x", W/"abc"', '"abc"'));
    assert.ok(etagMatches('*', '"abc"'));
    assert.ok(!etagMatches('"abd"', '"abc"'));
    assert.ok(!etagMatches(undefined, '"abc"'));
  });
});

/** Uploads a song and returns what a player needs: its URL and the exact bytes on disk. */
async function uploadSong(server, buffer = makeMp3({ seconds: 30, tags: { title: 'Streamed' } })) {
  const { status, body: track } = await server.upload(buffer, 'song');
  assert.equal(status, 201);
  return { track, bytes: buffer };
}

async function get(server, path, headers = {}) {
  const res = await server.fetch(path, { headers });
  return { res, body: Buffer.from(await res.arrayBuffer()) };
}

describe('GET /api/tracks/:id/stream', () => {
  test('sends the whole file and advertises range support', async (t) => {
    const server = await startServer(t);
    const { track, bytes } = await uploadSong(server);

    const { res, body } = await get(server, track.streamUrl);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    assert.equal(Number(res.headers.get('content-length')), bytes.length);
    assert.match(res.headers.get('etag'), /^"[a-f0-9]{64}"$/);
    assert.deepEqual(body, bytes);
  });

  test('sends 206 with exactly the requested bytes', async (t) => {
    const server = await startServer(t);
    const { track, bytes } = await uploadSong(server);
    const size = bytes.length;

    const middle = await get(server, track.streamUrl, { range: 'bytes=1000-1999' });
    assert.equal(middle.res.status, 206);
    assert.equal(middle.res.headers.get('content-range'), `bytes 1000-1999/${size}`);
    assert.equal(Number(middle.res.headers.get('content-length')), 1000);
    assert.deepEqual(middle.body, bytes.subarray(1000, 2000));

    const toEnd = await get(server, track.streamUrl, { range: `bytes=${size - 300}-` });
    assert.equal(toEnd.res.headers.get('content-range'), `bytes ${size - 300}-${size - 1}/${size}`);
    assert.deepEqual(toEnd.body, bytes.subarray(size - 300));

    const suffix = await get(server, track.streamUrl, { range: 'bytes=-128' });
    assert.deepEqual(suffix.body, bytes.subarray(size - 128));

    const clamped = await get(server, track.streamUrl, { range: `bytes=${size - 10}-${size * 2}` });
    assert.equal(clamped.res.status, 206);
    assert.equal(clamped.body.length, 10);
  });

  test('seeking: a range starting at a frame offset lands on that frame', async (t) => {
    // What a player does when you drag to 0:15 in a constant-bitrate MP3:
    // it works out the byte offset and requests from there.
    const server = await startServer(t);
    const { track, bytes } = await uploadSong(server, makeMp3({ seconds: 30 }));
    const frame = Math.round(15 / MP3_FRAME_SECONDS);
    const offset = frame * 417;

    const { res, body } = await get(server, track.streamUrl, { range: `bytes=${offset}-` });

    assert.equal(res.status, 206);
    assert.deepEqual([...body.subarray(0, 2)], [0xff, 0xfb], 'starts on an MPEG frame header');
    assert.deepEqual(body, bytes.subarray(offset));
  });

  test('answers 416 for a range past the end, without caching headers', async (t) => {
    const server = await startServer(t);
    const { track, bytes } = await uploadSong(server);

    const { res } = await get(server, track.streamUrl, { range: `bytes=${bytes.length}-` });

    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), `bytes */${bytes.length}`);
    assert.equal(res.headers.get('cache-control'), null);
  });

  test('ignores ranges it does not support and sends the whole file', async (t) => {
    const server = await startServer(t);
    const { track, bytes } = await uploadSong(server);

    for (const range of ['bytes=0-1,5-9', 'bytes=500-100', 'items=0-10']) {
      const { res, body } = await get(server, track.streamUrl, { range });
      assert.equal(res.status, 200, range);
      assert.equal(body.length, bytes.length, range);
    }
  });

  test('If-Range: honours the range only for the same file', async (t) => {
    const server = await startServer(t);
    const { track } = await uploadSong(server);
    const etag = (await server.fetch(track.streamUrl, { method: 'HEAD' })).headers.get('etag');

    const same = await get(server, track.streamUrl, { range: 'bytes=0-9', 'if-range': etag });
    assert.equal(same.res.status, 206);

    const changed = await get(server, track.streamUrl, { range: 'bytes=0-9', 'if-range': '"something-else"' });
    assert.equal(changed.res.status, 200);
  });

  test('If-None-Match: 304 when the client already has the file', async (t) => {
    const server = await startServer(t);
    const { track } = await uploadSong(server);
    const etag = (await server.fetch(track.streamUrl, { method: 'HEAD' })).headers.get('etag');

    const { res, body } = await get(server, track.streamUrl, { 'if-none-match': etag });

    assert.equal(res.status, 304);
    assert.equal(res.headers.get('etag'), etag);
    assert.equal(body.length, 0);
  });

  test('HEAD returns the headers of a GET with no body', async (t) => {
    const server = await startServer(t);
    const { track, bytes } = await uploadSong(server);

    const full = await get(server, track.streamUrl);
    const head = await server.fetch(track.streamUrl, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), bytes.length);
    assert.equal(head.headers.get('content-type'), full.res.headers.get('content-type'));
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const rangedHead = await server.fetch(track.streamUrl, { method: 'HEAD', headers: { range: 'bytes=0-99' } });
    assert.equal(rangedHead.status, 206);
    assert.equal(Number(rangedHead.headers.get('content-length')), 100);
  });

  test('a player hanging up mid-stream does not break anything', async (t) => {
    // Seeking makes browsers abort the request in flight and start a new one.
    const server = await startServer(t);
    const { track, bytes } = await uploadSong(server, makeWav({ seconds: 300 })); // about 4.8 MB

    for (let i = 0; i < 5; i++) {
      const controller = new AbortController();
      const res = await server.fetch(track.streamUrl, { signal: controller.signal });
      const reader = res.body.getReader();
      await reader.read();
      controller.abort();
      await reader.closed.catch(() => {});
    }

    const after = await get(server, track.streamUrl, { range: 'bytes=0-15' });
    assert.deepEqual(after.body, bytes.subarray(0, 16));

    // The file is not left open: deleting the track removes it (Windows refuses to delete open files).
    assert.equal((await server.json(`/api/tracks/${track.id}`, { method: 'DELETE' })).status, 204);
    assert.deepEqual(await server.files('music'), []);
  });

  test('404 for an unknown track, and for a track whose file is gone', async (t) => {
    const server = await startServer(t);
    assert.equal((await server.fetch('/api/tracks/9999/stream')).status, 404);

    const { track } = await uploadSong(server);
    const [stored] = await server.files('music');
    await rm(join(server.dataDir, 'music', stored));
    const res = await server.fetch(track.streamUrl);
    assert.equal(res.status, 404);
    assert.match((await res.json()).message, /missing/);
  });

  test('sends each format with its own content type', async (t) => {
    const server = await startServer(t);
    const { track } = await uploadSong(server, makeWav({ seconds: 2, tags: { title: 'W' } }));
    const { res, body } = await get(server, track.streamUrl, { range: 'bytes=0-3' });
    assert.equal(res.headers.get('content-type'), 'audio/wav');
    assert.equal(body.toString('latin1'), 'RIFF');
  });
});
