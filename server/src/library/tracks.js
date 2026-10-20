import { posix } from 'node:path';

const INSERT_COLUMNS = [
  'title', 'artist', 'album', 'year', 'track_no', 'duration', 'source',
  'file_path', 'file_hash', 'file_size', 'mime_type', 'original_name', 'cover_path', 'uploaded_by',
];

const MAX_SEARCH_TERMS = 8;

/**
 * Tracks plus whether the user $user liked each one. Every query that hands
 * tracks to a client starts here, so hearts are always filled in.
 */
export const TRACK_SELECT = `
  SELECT t.*, (l.user_id IS NOT NULL) AS liked
  FROM tracks t
  LEFT JOIN likes l ON l.track_id = t.id AND l.user_id = $user
`;

function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

/** SQL access for the tracks table. Rows use the database's snake_case names. */
export function createTrackStore(db) {
  const insert = db.prepare(`
    INSERT INTO tracks (${INSERT_COLUMNS.join(', ')})
    VALUES (${INSERT_COLUMNS.map((c) => `$${c}`).join(', ')})
    RETURNING *
  `);
  const byId = db.prepare(`${TRACK_SELECT} WHERE t.id = $id`);
  const byHash = db.prepare('SELECT * FROM tracks WHERE file_hash = ?');
  const deleteById = db.prepare('DELETE FROM tracks WHERE id = ?');
  const coverUseCount = db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE cover_path = ?');
  const totalCount = db.prepare('SELECT COUNT(*) AS n FROM tracks');

  return {
    insert(row) {
      return insert.get(Object.fromEntries(INSERT_COLUMNS.map((c) => [c, row[c] ?? null])));
    },
    findById: (id, userId = null) => byId.get({ id, user: userId }),
    findByHash: (hash) => byHash.get(hash),
    delete: (id) => deleteById.run(id).changes > 0,
    coverUseCount: (coverPath) => coverUseCount.get(coverPath).n,
    count: () => totalCount.get().n,

    /**
     * Newest first. Each word of the query must appear in the title, artist
     * or album, so "daft lucky" finds "Get Lucky" by Daft Punk.
     */
    list({ q, userId = null } = {}) {
      const terms = String(q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS);
      const where = terms.map(
        (_, i) => `(t.title LIKE $t${i} ESCAPE '\\' OR t.artist LIKE $t${i} ESCAPE '\\' OR t.album LIKE $t${i} ESCAPE '\\')`,
      );
      const sql = `${TRACK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.uploaded_at DESC, t.id DESC`;
      const params = Object.fromEntries(terms.map((t, i) => [`t${i}`, `%${escapeLike(t)}%`]));
      return db.prepare(sql).all({ ...params, user: userId });
    },
  };
}

/** The public JSON shape of a track. */
export function toApi(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    year: row.year,
    trackNo: row.track_no,
    duration: row.duration,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    streamUrl: `/api/tracks/${row.id}/stream`,
    coverUrl: row.cover_path ? `/api/covers/${posix.basename(row.cover_path)}` : null,
    liked: row.liked === 1,
    uploadedBy: row.uploaded_by ?? null,
    uploadedAt: row.uploaded_at,
  };
}
