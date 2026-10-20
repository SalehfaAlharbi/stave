import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { makeMp3 } from './fixtures.js';
import { startServer } from './helpers.js';

async function seed(server, titles = ['One', 'Two', 'Three']) {
  const ids = [];
  for (const [i, title] of titles.entries()) {
    const { body } = await server.upload(makeMp3({ seconds: 2 + i, tags: { title } }), `${title}.mp3`);
    ids.push(body.id);
  }
  return ids;
}

const titles = (tracks) => tracks.map((t) => t.title);

describe('Liked Songs', () => {
  test('liking shows up in the track list and in Liked Songs, newest like first', async (t) => {
    const server = await startServer(t);
    const [one, two, three] = await seed(server);

    assert.equal((await server.json(`/api/likes/${one}`, { method: 'PUT' })).status, 204);
    await server.json(`/api/likes/${three}`, { method: 'PUT' });
    await server.json(`/api/likes/${three}`, { method: 'PUT' }); // twice is fine

    const liked = await server.json('/api/likes');
    assert.deepEqual(titles(liked.body.tracks), ['Three', 'One']);
    assert.ok(liked.body.tracks.every((track) => track.liked));

    const all = (await server.json('/api/tracks')).body.tracks;
    assert.deepEqual(all.map((track) => [track.title, track.liked]), [['Three', true], ['Two', false], ['One', true]]);
    assert.equal((await server.json(`/api/tracks/${two}`)).body.liked, false);

    await server.json(`/api/likes/${one}`, { method: 'DELETE' });
    assert.deepEqual(titles((await server.json('/api/likes')).body.tracks), ['Three']);
    assert.equal((await server.json('/api/likes/9999', { method: 'PUT' })).status, 404);
  });

  test('likes are per user', async (t) => {
    const server = await startServer(t);
    const [one] = await seed(server, ['Shared']);
    const sam = await server.addUser('Sam');

    await server.json(`/api/likes/${one}`, { method: 'PUT' });
    assert.deepEqual((await sam.json('/api/likes')).body.tracks, []);
    assert.equal((await sam.json('/api/tracks')).body.tracks[0].liked, false);
  });
});

describe('playlists', () => {
  test('create, add songs in order, rename, remove a song, delete', async (t) => {
    const server = await startServer(t);
    const [one, two, three] = await seed(server);

    const created = await server.json('/api/playlists', { method: 'POST', body: { name: '  Late   Night  ' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Late Night', 'names are tidied');
    const url = `/api/playlists/${created.body.id}`;

    for (const id of [three, one, two]) {
      assert.equal((await server.json(`${url}/tracks`, { method: 'POST', body: { trackId: id } })).status, 201);
    }
    const dup = await server.json(`${url}/tracks`, { method: 'POST', body: { trackId: one } });
    assert.equal(dup.status, 409);

    let playlist = (await server.json(url)).body;
    assert.deepEqual(titles(playlist.tracks), ['Three', 'One', 'Two'], 'in the order they were added');
    assert.equal(playlist.trackCount, 3);
    assert.ok(Math.abs(playlist.duration - 9) < 0.1);

    assert.equal((await server.json(url, { method: 'PATCH', body: { name: 'Focus' } })).body.name, 'Focus');
    assert.equal((await server.json(`${url}/tracks/${one}`, { method: 'DELETE' })).status, 204);
    playlist = (await server.json(url)).body;
    assert.deepEqual(titles(playlist.tracks), ['Three', 'Two']);

    const list = (await server.json('/api/playlists')).body.playlists;
    assert.deepEqual(list.map((p) => [p.name, p.trackCount]), [['Focus', 2]]);

    assert.equal((await server.json(url, { method: 'DELETE' })).status, 204);
    assert.equal((await server.json(url)).status, 404);
  });

  test("another user's playlists look like they don't exist", async (t) => {
    const server = await startServer(t);
    const [one] = await seed(server, ['Mine']);
    const { body: playlist } = await server.json('/api/playlists', { method: 'POST', body: { name: 'Private' } });
    const sam = await server.addUser('Sam');
    const url = `/api/playlists/${playlist.id}`;

    assert.deepEqual((await sam.json('/api/playlists')).body.playlists, []);
    assert.equal((await sam.json(url)).status, 404);
    assert.equal((await sam.json(url, { method: 'PATCH', body: { name: 'Hijacked' } })).status, 404);
    assert.equal((await sam.json(`${url}/tracks`, { method: 'POST', body: { trackId: one } })).status, 404);
    assert.equal((await sam.json(url, { method: 'DELETE' })).status, 404);
    assert.equal((await server.json(url)).body.name, 'Private', 'untouched');
  });

  test('blank names are refused', async (t) => {
    const server = await startServer(t);
    assert.equal((await server.json('/api/playlists', { method: 'POST', body: { name: '   ' } })).status, 400);
    assert.equal((await server.json('/api/playlists', { method: 'POST', body: {} })).status, 400);
  });
});

describe('deleting a song from the shared library', () => {
  test('only its uploader or the admin may, and it leaves likes and playlists', async (t) => {
    const server = await startServer(t);
    const sam = await server.addUser('Sam');
    const robin = await server.addUser('Robin');

    const { body: track } = await sam.upload(makeMp3({ seconds: 3, tags: { title: 'Sams song' } }), 's.mp3');
    assert.equal(track.uploadedBy, sam.user.id);

    const { body: list } = await robin.json('/api/playlists', { method: 'POST', body: { name: 'Robin mix' } });
    await robin.json(`/api/playlists/${list.id}/tracks`, { method: 'POST', body: { trackId: track.id } });
    await robin.json(`/api/likes/${track.id}`, { method: 'PUT' });

    assert.equal((await robin.json(`/api/tracks/${track.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await sam.json(`/api/tracks/${track.id}`, { method: 'DELETE' })).status, 204);

    assert.deepEqual((await robin.json('/api/likes')).body.tracks, []);
    const after = (await robin.json(`/api/playlists/${list.id}`)).body;
    assert.deepEqual(after.tracks, []);
    assert.equal(after.trackCount, 0);

    const { body: other } = await robin.upload(makeMp3({ seconds: 4, tags: { title: 'Robins song' } }), 'r.mp3');
    assert.equal((await server.json(`/api/tracks/${other.id}`, { method: 'DELETE' })).status, 204, 'the admin may');
  });
});
