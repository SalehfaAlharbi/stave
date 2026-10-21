import { isLrc, lrcToPlain, parseLrc, parsePlain } from './lrc.js';

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** SQL for the lyrics table. Background writes only touch rows still 'pending'. */
export function createLyricsStore(db) {
  const q = {
    get: db.prepare('SELECT * FROM lyrics WHERE track_id = ?'),
    queue: db.prepare(`
      INSERT INTO lyrics (track_id, status, next_attempt_at) VALUES (?, 'pending', ?)
      ON CONFLICT (track_id) DO UPDATE SET status = 'pending', attempts = 0, last_error = NULL,
        next_attempt_at = excluded.next_attempt_at, updated_at = ${NOW_SQL}
    `),
    nextDue: db.prepare(`
      SELECT track_id, attempts FROM lyrics
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY next_attempt_at, track_id LIMIT 1
    `),
    nextAttemptAt: db.prepare("SELECT MIN(next_attempt_at) AS at FROM lyrics WHERE status = 'pending'"),
    save: db.prepare(`
      UPDATE lyrics SET status = $status, source = $source, synced = $synced, plain = $plain, lrclib_id = $lrclibId,
        attempts = attempts + $tried, next_attempt_at = NULL, last_error = $error, updated_at = ${NOW_SQL}
      WHERE track_id = $trackId AND ($onlyPending = 0 OR status = 'pending')
    `),
    retryLater: db.prepare(`
      UPDATE lyrics SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ${NOW_SQL}
      WHERE track_id = ? AND status = 'pending'
    `),
  };

  function save(trackId, fields, { onlyPending = false, tried = 0 } = {}) {
    q.save.run({
      trackId, onlyPending: onlyPending ? 1 : 0, tried,
      status: fields.status, source: fields.source ?? null, synced: fields.synced ?? null,
      plain: fields.plain ?? null, lrclibId: fields.lrclibId ?? null, error: fields.error ?? null,
    });
  }

  return {
    get: (trackId) => q.get.get(trackId),
    queue: (trackId) => q.queue.run(trackId, new Date().toISOString()),
    nextDue: () => q.nextDue.get(new Date().toISOString()),
    nextAttemptAt: () => q.nextAttemptAt.get().at,
    retryLater: (trackId, attempts, at, error) => q.retryLater.run(attempts, at, error, trackId),

    /** Stores an LRCLIB answer. `onlyPending` keeps a background lookup from overwriting a hand edit. */
    saveLookup(trackId, result, { onlyPending, error = null }) {
      if (result.kind === 'found') {
        save(trackId, { status: 'found', source: 'lrclib', synced: result.synced, plain: result.plain, lrclibId: result.id }, { onlyPending, tried: 1 });
      } else if (result.kind === 'instrumental') {
        save(trackId, { status: 'instrumental', source: 'lrclib', lrclibId: result.id }, { onlyPending, tried: 1 });
      } else {
        save(trackId, { status: 'missing', error }, { onlyPending, tried: 1 });
      }
    },

    /** Lyrics typed or pasted by hand: LRC becomes synced lyrics, anything else plain. */
    saveManual(trackId, text) {
      const synced = isLrc(text);
      this.addMissing(trackId);
      save(trackId, {
        status: 'found',
        source: 'manual',
        synced: synced ? text : null,
        plain: synced ? lrcToPlain(text) : text,
      });
    },

    clear: (trackId) => save(trackId, { status: 'missing' }),

    /** A row for a new track when lookups are off. */
    addMissing: (trackId) => db.prepare("INSERT OR IGNORE INTO lyrics (track_id, status) VALUES (?, 'missing')").run(trackId),

    /** With lookups off, queued work will never run; say so instead of "looking". */
    abandonPending: () => db.prepare(`UPDATE lyrics SET status = 'missing', next_attempt_at = NULL, updated_at = ${NOW_SQL} WHERE status = 'pending'`).run().changes,
  };
}

/** The public JSON shape: parsed lines plus the raw text for the editor. */
export function toApiLyrics(row) {
  if (!row) return { status: 'missing', source: null, synced: false, lines: [], text: '' };
  const synced = Boolean(row.synced);
  return {
    status: row.status,
    source: row.source,
    synced,
    lines: synced ? parseLrc(row.synced) : parsePlain(row.plain),
    text: row.synced ?? row.plain ?? '',
    updatedAt: row.updated_at,
  };
}
