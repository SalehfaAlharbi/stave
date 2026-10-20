import { posix } from 'node:path';

const INSERT_COLUMNS = [
  'title', 'artist', 'album', 'year', 'track_no', 'duration', 'source',
  'file_path', 'file_hash', 'file_size', 'mime_type', 'original_name', 'cover_path',
];

const MAX_SEARCH_TERMS = 8;

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
  const byId = db.prepare('SELECT * FROM tracks WHERE id = ?');
  const byHash = db.prepare('SELECT * FROM tracks WHERE file_hash = ?');
  const deleteById = db.prepare('DELETE FROM tracks WHERE id = ?');
  const coverUseCount = db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE cover_path = ?');
  const totalCount = db.prepare('SELECT COUNT(*) AS n FROM tracks');

  return {
    insert(row) {
      return insert.get(Object.fromEntries(INSERT_COLUMNS.map((c) => [c, row[c] ?? null])));
    },
    findById: (id) => byId.get(id),
    findByHash: (hash) => byHash.get(hash),
    delete: (id) => deleteById.run(id).changes > 0,
    coverUseCount: (coverPath) => coverUseCount.get(coverPath).n,
    count: () => totalCount.get().n,

    /**
     * Newest first. Each word of the query must appear in the title, artist
     * or album, so "daft lucky" finds "Get Lucky" by Daft Punk.
     */
    list({ q } = {}) {
      const terms = String(q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS);
      const where = terms.map(
        (_, i) => `(title LIKE $t${i} ESCAPE '\\' OR artist LIKE $t${i} ESCAPE '\\' OR album LIKE $t${i} ESCAPE '\\')`,
      );
      const sql = `SELECT * FROM tracks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY uploaded_at DESC, id DESC`;
      const statement = db.prepare(sql);
      if (!terms.length) return statement.all();
      return statement.all(Object.fromEntries(terms.map((t, i) => [`t${i}`, `%${escapeLike(t)}%`])));
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
    uploadedAt: row.uploaded_at,
  };
}
