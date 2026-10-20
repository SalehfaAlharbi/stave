-- Phase 4: accounts, likes and playlists.
-- The library stays shared; likes and playlists belong to one user.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,                   -- scrypt$N$r$p$salt$hash
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Only a SHA-256 of each session token is stored, so a copy of the
-- database cannot be used to sign in.
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT    NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE invites (
  code_hash  TEXT    PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT    NOT NULL,
  used_by    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  used_at    TEXT
);

CREATE TABLE likes (
  user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  liked_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, track_id)
) WITHOUT ROWID;

CREATE TABLE playlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX playlists_user ON playlists (user_id);

-- A song appears in a playlist at most once; position orders the list.
CREATE TABLE playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  added_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (playlist_id, track_id)
) WITHOUT ROWID;
CREATE INDEX playlist_tracks_order ON playlist_tracks (playlist_id, position);
CREATE INDEX playlist_tracks_track ON playlist_tracks (track_id);
CREATE INDEX likes_track ON likes (track_id);

-- Songs uploaded before accounts existed keep a NULL uploader.
ALTER TABLE tracks ADD COLUMN uploaded_by INTEGER REFERENCES users (id) ON DELETE SET NULL;
