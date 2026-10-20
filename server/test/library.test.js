import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { makeMp3, PNG_1PX } from './fixtures.js';
import { startServer } from './helpers.js';

async function seed(server) {
  const songs = [
    { title: 'Get Lucky', artist: 'Daft Punk', album: 'Random Access Memories', seconds: 3 },
    { title: 'Around the World', artist: 'Daft Punk', album: 'Homework', seconds: 4 },
    { title: 'Lucky', artist: 'Radiohead', album: 'OK Computer', seconds: 5 },
    { title: '100% Pure', artist: 'Someone', album: 'Percent', seconds: 6 },
  ];
  const ids = [];
  for (const { seconds, ...tags } of songs) {
    const { status, body } = await server.upload(makeMp3({ seconds, tags }), `${tags.title}.mp3`);
    assert.equal(status, 201);
    ids.push(body.id);
  }
  return ids;
}

const titles = (body) => body.tracks.map((track) => track.title);

describe('GET /api/tracks', () => {
  test('lists newest uploads first', async (t) => {
    const server = await startServer(t);
    await seed(server);
    const { status, body } = await server.json('/api/tracks');
    assert.equal(status, 200);
    assert.deepEqual(titles(body), ['100% Pure', 'Lucky', 'Around the World', 'Get Lucky']);
  });

  test('searches title, artist and album; every word has to match', async (t) => {
    const server = await startServer(t);
    await seed(server);
    const search = async (q) => titles((await server.json(`/api/tracks?q=${encodeURIComponent(q)}`)).body);

    assert.deepEqual(await search('lucky'), ['Lucky', 'Get Lucky']);
    assert.deepEqual(await search('DAFT lucky'), ['Get Lucky']);
    assert.deepEqual(await search('homework'), ['Around the World']);
    assert.deepEqual(await search('radiohead computer'), ['Lucky']);
    assert.deepEqual(await search('nothing matches this'), []);
    assert.deepEqual(await search('   '), ['100% Pure', 'Lucky', 'Around the World', 'Get Lucky']);
  });

  test('treats % and _ in a search as plain characters', async (t) => {
    const server = await startServer(t);
    await seed(server);
    assert.deepEqual(titles((await server.json('/api/tracks?q=%25')).body), ['100% Pure']);
    assert.deepEqual(titles((await server.json('/api/tracks?q=_')).body), []);
  });
});

describe('GET /api/tracks/:id', () => {
  test('returns one track, 404 for unknown ids and 400 for invalid ones', async (t) => {
    const server = await startServer(t);
    const [id] = await seed(server);

    const found = await server.json(`/api/tracks/${id}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.title, 'Get Lucky');

    assert.equal((await server.json('/api/tracks/9999')).status, 404);
    assert.equal((await server.json('/api/tracks/abc')).status, 400);
  });
});

describe('DELETE /api/tracks/:id', () => {
  test('removes the row and the audio file; a shared cover stays until its last track goes', async (t) => {
    const server = await startServer(t);
    const album = { album: 'Shared', artist: 'X', cover: PNG_1PX };
    const a = await server.upload(makeMp3({ seconds: 3, tags: { ...album, title: 'A' } }), 'a.mp3');
    const b = await server.upload(makeMp3({ seconds: 4, tags: { ...album, title: 'B' } }), 'b.mp3');

    assert.equal((await server.json(`/api/tracks/${a.body.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await server.json(`/api/tracks/${a.body.id}`)).status, 404);
    assert.equal((await server.files('music')).length, 1);
    assert.equal((await server.files('covers')).length, 1, 'B still uses the cover');
    assert.equal((await server.fetch(b.body.coverUrl)).status, 200);

    await server.json(`/api/tracks/${b.body.id}`, { method: 'DELETE' });
    assert.deepEqual(await server.files('music'), []);
    assert.deepEqual(await server.files('covers'), []);
    assert.equal((await server.json(`/api/tracks/${b.body.id}`, { method: 'DELETE' })).status, 404);
  });

  test('does not reuse the id of a deleted track', async (t) => {
    const server = await startServer(t);
    const first = await server.upload(makeMp3({ seconds: 3 }), 'one.mp3');
    await server.json(`/api/tracks/${first.body.id}`, { method: 'DELETE' });
    const second = await server.upload(makeMp3({ seconds: 4 }), 'two.mp3');
    assert.notEqual(second.body.id, first.body.id);
  });
});

describe('covers', () => {
  test('only serves well-formed cover names', async (t) => {
    const server = await startServer(t);
    assert.equal((await server.fetch('/api/covers/..%2F..%2Fstave.db')).status, 404);
    assert.equal((await server.fetch(`/api/covers/${'a'.repeat(64)}.png`)).status, 404);
  });
});

describe('persistence', () => {
  test('the library survives a restart, and migrations run only once', async (t) => {
    const first = await startServer(t, { keepDataDir: true });
    await seed(first);
    await first.app.close();

    const second = await startServer(t, { dataDir: first.dataDir });
    const { body } = await second.json('/api/tracks');
    assert.equal(body.tracks.length, 4);

    const health = await second.json('/api/health');
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.tracks, 4);

    const db = new DatabaseSync(join(first.dataDir, 'stave.db'), { readOnly: true });
    const { user_version: version } = db.prepare('PRAGMA user_version').get();
    db.close();
    assert.equal(version, 1);
  });
});
