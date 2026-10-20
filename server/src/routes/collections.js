import { httpError } from '../errors.js';
import { toApiPlaylist } from '../library/collections.js';
import { toApi } from '../library/tracks.js';

const id = { type: 'integer', minimum: 1 };
const params = (...names) => ({
  type: 'object',
  required: names,
  properties: Object.fromEntries(names.map((n) => [n, id])),
});
const nameBody = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
};

function playlistName(raw) {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) throw httpError(400, 'Give the playlist a name.');
  return name;
}

/** Liked Songs and playlists; everything is scoped to the signed-in user. */
export default async function collectionRoutes(app, { collections }) {
  // ---- Liked Songs ----

  app.get('/api/likes', async (request) => ({
    tracks: collections.likedTracks(request.user.id).map(toApi),
  }));

  app.put('/api/likes/:trackId', { schema: { params: params('trackId') } }, async (request, reply) => {
    if (!collections.like(request.user.id, request.params.trackId)) throw httpError(404, 'Track not found.');
    return reply.code(204).send();
  });

  app.delete('/api/likes/:trackId', { schema: { params: params('trackId') } }, async (request, reply) => {
    collections.unlike(request.user.id, request.params.trackId);
    return reply.code(204).send();
  });

  // ---- Playlists ----

  function ownPlaylist(request) {
    const playlist = collections.playlist(request.user.id, request.params.id);
    if (!playlist) throw httpError(404, 'Playlist not found.'); // also for other users' playlists
    return playlist;
  }

  app.get('/api/playlists', async (request) => ({
    playlists: collections.playlists(request.user.id).map(toApiPlaylist),
  }));

  app.post('/api/playlists', { schema: { body: nameBody } }, async (request, reply) => {
    const playlist = collections.createPlaylist(request.user.id, playlistName(request.body.name));
    return reply.code(201).header('location', `/api/playlists/${playlist.id}`).send(toApiPlaylist(playlist));
  });

  app.get('/api/playlists/:id', { schema: { params: params('id') } }, async (request) => {
    const playlist = ownPlaylist(request);
    return {
      ...toApiPlaylist(playlist),
      tracks: collections.playlistTracks(request.user.id, playlist.id).map(toApi),
    };
  });

  app.patch('/api/playlists/:id', { schema: { params: params('id'), body: nameBody } }, async (request) => {
    ownPlaylist(request);
    collections.renamePlaylist(request.user.id, request.params.id, playlistName(request.body.name));
    return toApiPlaylist(ownPlaylist(request));
  });

  app.delete('/api/playlists/:id', { schema: { params: params('id') } }, async (request, reply) => {
    if (!collections.deletePlaylist(request.user.id, request.params.id)) throw httpError(404, 'Playlist not found.');
    return reply.code(204).send();
  });

  app.post('/api/playlists/:id/tracks', {
    schema: {
      params: params('id'),
      body: { type: 'object', required: ['trackId'], additionalProperties: false, properties: { trackId: id } },
    },
  }, async (request, reply) => {
    const playlist = ownPlaylist(request);
    if (!collections.trackExists(request.body.trackId)) throw httpError(404, 'Track not found.');
    if (!collections.addToPlaylist(playlist.id, request.body.trackId)) {
      throw httpError(409, `That song is already in "${playlist.name}".`);
    }
    return reply.code(201).send(toApiPlaylist(ownPlaylist(request)));
  });

  app.delete('/api/playlists/:id/tracks/:trackId', { schema: { params: params('id', 'trackId') } }, async (request, reply) => {
    const playlist = ownPlaylist(request);
    if (!collections.removeFromPlaylist(playlist.id, request.params.trackId)) {
      throw httpError(404, 'That song is not in this playlist.');
    }
    return reply.code(204).send();
  });
}
