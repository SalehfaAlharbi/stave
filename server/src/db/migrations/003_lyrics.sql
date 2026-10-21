-- Phase 5: lyrics, one row per track.
--   pending       waiting for an LRCLIB lookup (next_attempt_at says when)
--   found         synced and/or plain lyrics, from LRCLIB or typed in by hand
--   instrumental  LRCLIB says the song has no vocals
--   missing       nobody has lyrics for it (yet)
-- Lyrics are kept as text: synced ones as LRC ("[01:23.45] line"), which is
-- what LRCLIB returns and what people paste; the API parses them on read.

CREATE TABLE lyrics (
  track_id        INTEGER PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
  status          TEXT    NOT NULL CHECK (status IN ('pending', 'found', 'instrumental', 'missing')),
  source          TEXT    CHECK (source IN ('lrclib', 'manual')),
  synced          TEXT,
  plain           TEXT,
  lrclib_id       INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error      TEXT,
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX lyrics_due ON lyrics (status, next_attempt_at);

-- Songs uploaded before this phase get looked up too.
INSERT INTO lyrics (track_id, status, next_attempt_at)
SELECT id, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tracks;
