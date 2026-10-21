# Stave

A self-hosted, Spotify-style music player. Upload songs from any device to a
server on your own hardware, then stream them back to a polished player on PC
and phone. The full plan is in [docs/STAVE.md](docs/STAVE.md).

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Server and library: upload, tag reading, SQLite | done |
| 2 | Streaming with HTTP range requests | done |
| 3 | Player UI | done |
| 4 | Accounts, likes and playlists | done |
| 5 | Synced lyrics | done |
| 6 | Docker Compose deploy on the SER8 | next |
| 7 | Polish: PWA install, media keys | |

## Running it

Node.js 22.13+ (uses the built-in `node:sqlite`).

```bash
cd server
npm install
npm run dev     # then open http://127.0.0.1:4545
```

The server serves both the API and the web client. Tests: `npm test` in
`server/` and in `client/`.

**First run:** with no accounts yet, the server prints a one-time setup code:

```
No accounts yet. Open Stave in a browser and create the admin account with setup code K7QM-2XRT-9WHP
```

Open the app, pick a name and password, and enter that code. You become the
admin, and you can invite other people from the account menu (top right).

## Client

Plain HTML, CSS and ES modules in [client/](client/), with no framework and no
build step. It's a port of the Stave Player Mockup at 1280×800 that also works
at phone width.

- **Views:** Songs (the whole library, with search), Liked Songs, and each playlist, at `#/`, `#/liked` and `#/playlist/<id>`, so Back and reload work. The hero names the list and plays or shuffles it. Click any row to play from there.
- **Liked Songs and playlists:** a heart on every row. The "+" next to Playlists creates one inline. Each row's "…" menu adds the song to a playlist, removes it from the one you're in, or deletes it from the library if you added it (or you're the admin). Playlists can be renamed and deleted from the hero's "…" menu.
- **Accounts:** a sign-in screen, first-run setup with the code from the log, and joining through an invite link.
- **Player bar:** play/pause, previous (restarts the song after 3 s), next, shuffle, repeat (off / all / this song), seek and volume. Space plays and pauses. Volume, shuffle and repeat are remembered.
- **Dot-helix seek bar:** the played part is white and accent dots orbiting each other (the mockup's 2 s cycle); the part still to play is flat dots. Drag it, or use the arrow keys.
- **Wave volume bar:** bars on a flat baseline under a sine envelope. Lit bars dance while music plays, the edge bar is the accent-colored handle, and the rest are dots.
- **Vinyl:** grooves and sheen stay still; only the cover on the label turns, at 90°/s, and only while playing.
- **Color:** the backdrop is the cover blurred and darkened, crossfading between songs. The accent is the cover's most vivid hue, lightened until it passes 4.5:1 contrast as text.
- **Add song:** the button, or drop files anywhere on the window. One toast per batch shows progress and lists what failed and why.
- **Lyrics tab:** synced lyrics follow the song. The current line is in the accent color, the others fade and blur with distance (as in the mockup), the view keeps the current line centered (pausing while you scroll), and clicking a line seeks to it. Plain lyrics show unsynced. "Add lyrics" / "Edit lyrics" opens an editor: paste plain text or LRC, or press **Stamp line** while the song plays to sync it by hand. "Search LRCLIB again" retries the lookup.

Tag text is inserted with `textContent` only, because tags come from uploaded
files. A Content-Security-Policy limits the page to its own origin plus Google
Fonts.

| File | |
| --- | --- |
| [src/player.js](client/src/player.js) | The audio element, queue, shuffle and repeat rules |
| [src/queue.js](client/src/queue.js) | Pure play-order logic (unit-tested) |
| [src/accent.js](client/src/accent.js) | Accent color from cover pixels |
| [src/ui/helix.js](client/src/ui/helix.js), [src/ui/wave.js](client/src/ui/wave.js) | The two animated bars: pure geometry plus a small DOM renderer |
| [src/ui/upload.js](client/src/ui/upload.js) | Upload with progress (XHR) and drag-and-drop |

## Server

Fastify, music-metadata and `node:sqlite`.

### API

| Method | Path | |
| --- | --- | --- |
Everything under `/api` needs a signed-in session, except health and the
sign-in endpoints. Tracks carry `liked` for the user asking.

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/health` | Status and version (plus track count when signed in). Public, for health checks |
| `GET` | `/api/auth/status` | The signed-in user, and whether first-run setup is needed |
| `POST` | `/api/auth/setup` | First run only: `{ name, password, code }` creates the admin |
| `POST` | `/api/auth/login` · `/api/auth/logout` | Sign in (`429` after 10 failures in 15 minutes) and out |
| `POST` | `/api/invites` | Admin: a single-use invite link, valid 7 days |
| `GET` · `POST` | `/api/invites/:code` · `/api/auth/register` | Check an invite; create an account with it |
| `POST` | `/api/tracks` | Upload one song as `multipart/form-data` (field `file`). `201` with the track, `409` if the exact file is already in the library, `413` if too large, `415` if not a playable audio file |
| `GET` | `/api/tracks?q=` | All tracks, newest first. `q` searches title, artist and album; every word must match |
| `GET` | `/api/tracks/:id` | One track |
| `GET` `HEAD` | `/api/tracks/:id/stream` | The audio, with range requests (`206`, `416`), `If-Range`, and the file hash as a strong `ETag` |
| `DELETE` | `/api/tracks/:id` | Whoever added it, or the admin: removes the track, its file, and its cover if unused |
| `GET` | `/api/covers/:name` | Cover art extracted from the tags |
| `GET` | `/api/tracks/:id/lyrics` | `{ status, source, synced, lines: [{ time, text }], text }`. Status is `pending`, `found`, `instrumental` or `missing` |
| `PUT` · `DELETE` | `/api/tracks/:id/lyrics` | Save lyrics by hand `{ text }` (LRC is detected and stays synced); remove them |
| `POST` | `/api/tracks/:id/lyrics/lookup` | Ask LRCLIB again now (`503` if it's busy) |
| `GET` | `/api/likes` | Your Liked Songs, newest first |
| `PUT` · `DELETE` | `/api/likes/:trackId` | Like, unlike |
| `GET` · `POST` | `/api/playlists` | Your playlists (with song count and length); create one `{ name }` |
| `GET` · `PATCH` · `DELETE` | `/api/playlists/:id` | One playlist with its songs; rename; delete |
| `POST` · `DELETE` | `/api/playlists/:id/tracks[/:trackId]` | Add `{ trackId }` (`409` if already there); remove |

### How accounts work

- **One shared library, private collections.** Everyone sees the same songs. Likes and playlists belong to one user, and another user's playlist answers `404`, so even its existence isn't revealed.
- **Passwords** are hashed with scrypt (built into Node, memory-hard) with a per-user salt. A sign-in with an unknown name still runs a hash, so response times don't reveal which names exist.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS). The database stores only their SHA-256, so a copy of it can't be used to sign in. They last 30 days and renew while in use.
- **Cross-site requests** that change anything are refused when their `Origin` is another site, on top of `SameSite`.
- **First run** needs the setup code from the server log, so whoever opens a fresh server first can't take it over. **Invites** are single-use and stored hashed.

### How uploads work

1. The file is streamed to `data/tmp/`, hashed (SHA-256) and size-checked on the way, never held in memory.
2. The format is detected from the file's **contents**, not its name, and only formats browsers can play are kept: MP3, FLAC, M4A/AAC, Ogg Vorbis, Opus, WAV.
3. Tags and the front cover are read with music-metadata. Files without tags fall back to the file name (`03. Artist - Title.mp3`).
4. Audio is stored as `data/music/<sha256>.<ext>` and covers as `data/covers/<sha256>.<ext>`, so duplicates are caught by hash and an album's tracks share one cover file.

### How streaming works

Players don't download a song and then play it. They ask for byte ranges: a
little from the start to read the header, then `Range: bytes=<offset>-` from
wherever you seek to. The server answers `206 Partial Content` with exactly
those bytes, so playback starts at once and seeking to 5:00 in a long FLAC
doesn't fetch the first five minutes.

- One range per request (`bytes=a-b`, `bytes=a-`, `bytes=-n`). Malformed, backwards or multi-range headers get the whole file, as RFC 9110 allows. A range past the end gets `416`.
- A track's file never changes, so its SHA-256 is a strong `ETag`. `If-None-Match` gives `304`, `If-Range` makes sure ranges come from the same file, and responses are cacheable for good.
- `HEAD` is a real handler that never opens the file. Fastify's automatic HEAD would read the whole file just to throw it away.
- Seeking was tested in Chrome: with only the first 24 s buffered, a jump to 5:00 in a 10-minute file left the buffer as `0–24.6s` and `299–503.8s`.

### How lyrics work

Each upload is queued for a lookup on [LRCLIB](https://lrclib.net), a free,
open lyrics database. It matches on title, artist, album and length (±2 s).

- **One request at a time, a second apart,** from a queue kept in the database, so an album upload isn't a burst and the work survives restarts. Songs uploaded before lyrics existed are queued by the migration.
- **A miss with the album is retried without it,** because albums are often tagged differently ("Deluxe Edition"). LRCLIB's search isn't used: it also returns covers and radio edits.
- **404 means LRCLIB has nothing; 429 and 5xx mean try later.** LRCLIB answers `503` when overloaded, even for songs it doesn't have, so those retry after 1, 5, 30, 120 and 720 minutes, then give up. `Retry-After` is respected.
- **Lyrics typed in by hand win.** Background lookups only write to songs still waiting, so a hand edit is never overwritten. "Search again" keeps hand-made lyrics if LRCLIB still has nothing.
- **Stored as text, parsed on read.** Synced lyrics are kept as LRC, the format LRCLIB returns and people paste. The parser handles multiple stamps per line, `[offset]`, metadata tags and word-level stamps.
- **Privacy:** lookups send a song's title, artist, album and length to lrclib.net. Set `STAVE_LRCLIB_URL=off` to keep them on the server.

Tested against the real LRCLIB with five well-known songs: four came back with
synced lyrics and one as an instrumental. Made-up songs came back missing, or
were queued for a retry when LRCLIB answered `503`.

### Configuration

| Variable | Default | |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | `0.0.0.0` to reach it from other devices |
| `PORT` | `4545` | |
| `STAVE_DATA_DIR` | `server/data` | Database, music and covers |
| `STAVE_MAX_UPLOAD_MB` | `300` | |
| `STAVE_LRCLIB_URL` | `https://lrclib.net` | `off` turns online lyrics lookups off |
| `TRUST_PROXY` | `false` | `true` behind a proxy or tunnel you control, so client addresses and HTTPS are read from `X-Forwarded-*` |
| `LOG_LEVEL` | `info` | |
