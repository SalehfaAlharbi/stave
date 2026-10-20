import { transaction } from '../db/index.js';
import { TRACK_SELECT } from './tracks.js';

const PLAYLIST_SELECT = `
  SELECT p.id, p.name, p.created_at,
         COUNT(pt.track_id) AS track_count,
         COALESCE(SUM(t.duration), 0) AS duration
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN tracks t ON t.id = pt.track_id
`;

export function toApiPlaylist(row) {
  return { id: row.id, name: row.name, trackCount: row.track_count, duration: row.duration, createdAt: row.created_at };
}

/**
 * Each user's likes and playlists. Every query is scoped by user id, so one
 * user can never read or change another's (the routes answer 404).
 */
export function createCollections(db) {
  const q = {
    trackExists: db.prepare('SELECT 1 FROM tracks WHERE id = ?'),
    like: db.prepare('INSERT OR IGNORE INTO likes (user_id, track_id) VALUES (?, ?)'),
    unlike: db.prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?'),
    liked: db.prepare(`${TRACK_SELECT} WHERE l.user_id IS NOT NULL ORDER BY l.liked_at DESC, t.id DESC`),

    playlists: db.prepare(`${PLAYLIST_SELECT} WHERE p.user_id = ? GROUP BY p.id ORDER BY p.created_at, p.id`),
    playlist: db.prepare(`${PLAYLIST_SELECT} WHERE p.user_id = ? AND p.id = ? GROUP BY p.id`),
    create: db.prepare('INSERT INTO playlists (user_id, name) VALUES (?, ?) RETURNING id'),
    rename: db.prepare('UPDATE playlists SET name = ? WHERE id = ? AND user_id = ?'),
    remove: db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?'),
    tracks: db.prepare(`
      ${TRACK_SELECT}
      JOIN playlist_tracks pt ON pt.track_id = t.id
      WHERE pt.playlist_id = $playlist
      ORDER BY pt.position, pt.added_at
    `),
    nextPosition: db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM playlist_tracks WHERE playlist_id = ?'),
    addTrack: db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)'),
    removeTrack: db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'),
  };

  const trackExists = (trackId) => Boolean(q.trackExists.get(trackId));

  return {
    trackExists,

    /** Returns false if the track doesn't exist. Liking twice is fine. */
    like(userId, trackId) {
      if (!trackExists(trackId)) return false;
      q.like.run(userId, trackId);
      return true;
    },
    unlike: (userId, trackId) => q.unlike.run(userId, trackId),
    likedTracks: (userId) => q.liked.all({ user: userId }),

    playlists: (userId) => q.playlists.all(userId),
    playlist: (userId, id) => q.playlist.get(userId, id),
    createPlaylist(userId, name) {
      const { id } = q.create.get(userId, name);
      return q.playlist.get(userId, id);
    },
    renamePlaylist: (userId, id, name) => q.rename.run(name, id, userId).changes > 0,
    deletePlaylist: (userId, id) => q.remove.run(id, userId).changes > 0,
    playlistTracks: (userId, playlistId) => q.tracks.all({ user: userId, playlist: playlistId }),

    /** Appends a track. Returns false if it was already in the playlist. */
    addToPlaylist(playlistId, trackId) {
      return transaction(db, () => {
        const { position } = q.nextPosition.get(playlistId);
        return q.addTrack.run(playlistId, trackId, position).changes > 0;
      });
    },
    removeFromPlaylist: (playlistId, trackId) => q.removeTrack.run(playlistId, trackId).changes > 0,
  };
}
