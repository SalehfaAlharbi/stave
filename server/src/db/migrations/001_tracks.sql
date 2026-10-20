-- Phase 1: the music library.
-- Users, likes and playlists arrive in a later migration (phase 4).

CREATE TABLE tracks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT, -- never reused, so client caches and playlists stay valid
  title         TEXT    NOT NULL,
  artist        TEXT,
  album         TEXT,
  year          INTEGER,
  track_no      INTEGER,
  duration      REAL,                              -- seconds
  source        TEXT    NOT NULL DEFAULT 'upload', -- pluggable sources; 'upload' = files stored on this server
  file_path     TEXT    NOT NULL,                  -- relative to the data dir, e.g. music/<sha256>.mp3
  file_hash     TEXT    NOT NULL UNIQUE,           -- sha256 of the file, used to reject duplicate uploads
  file_size     INTEGER NOT NULL,
  mime_type     TEXT    NOT NULL,
  original_name TEXT,
  cover_path    TEXT,                              -- relative to the data dir, e.g. covers/<sha256>.jpg
  uploaded_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX tracks_uploaded_at ON tracks (uploaded_at);
CREATE INDEX tracks_cover_path ON tracks (cover_path);
