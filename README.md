# Stave

A self-hosted, Spotify-style music player. Upload songs from any device to a
server on your own hardware, then stream them back to a polished player on PC
and phone. The full plan is in [docs/STAVE.md](docs/STAVE.md).

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Server and library: upload, tag reading, SQLite | done |
| 2 | Streaming with HTTP range requests | next |
| 3 | Player UI | |
| 4 | Accounts, likes and playlists | |
| 5 | Synced lyrics | |
| 6 | Docker Compose deploy on the SER8 | |
| 7 | Polish: PWA install, media keys | |

## Server

Node.js 22.13+ (uses the built-in `node:sqlite`), Fastify, music-metadata.

```bash
cd server
npm install
npm run dev     # http://127.0.0.1:4545, restarts on changes, readable logs
npm test
```

### API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/health` | Status, version and track count |
| `POST` | `/api/tracks` | Upload one song as `multipart/form-data` (field `file`). `201` with the track, `409` if the exact file is already in the library, `413` if too large, `415` if not a playable audio file |
| `GET` | `/api/tracks?q=` | All tracks, newest first. `q` searches title, artist and album; every word must match |
| `GET` | `/api/tracks/:id` | One track |
| `DELETE` | `/api/tracks/:id` | Remove a track, its file, and its cover if no other track uses it |
| `GET` | `/api/covers/:name` | Cover art extracted from the tags |

```bash
curl -F "file=@Some Artist - Some Song.mp3" http://127.0.0.1:4545/api/tracks
```

### How uploads work

1. The file is streamed to `data/tmp/`, hashed (SHA-256) and size-checked on the way, never held in memory.
2. The format is detected from the file's **contents**, not its name, and only formats browsers can play are kept: MP3, FLAC, M4A/AAC, Ogg Vorbis, Opus, WAV.
3. Tags and the front cover are read with music-metadata. Files without tags fall back to the file name (`03. Artist - Title.mp3`).
4. Audio is stored as `data/music/<sha256>.<ext>` and covers as `data/covers/<sha256>.<ext>`, so duplicates are caught by hash and an album's tracks share one cover file.

### Configuration

| Variable | Default | |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Local-only until login exists (phase 4) |
| `PORT` | `4545` | |
| `STAVE_DATA_DIR` | `server/data` | Database, music and covers |
| `STAVE_MAX_UPLOAD_MB` | `300` | |
| `LOG_LEVEL` | `info` | |
