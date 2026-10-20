# Stave: Project Document

Oct 20, 2026 · Saleh

## Overview

**Stave** is a self-hosted, Spotify-style music player. You upload songs from your own devices to a server running on your Beelink SER8, and play them back through a polished app on your PC and phone. It is a minimal player, deliberately not Spotify-level: songs, liked songs, playlists, lyrics and a great-looking now-playing experience.

- **Name and logo:** Stave, a staff in music notation. The logo is an S built from a treble clef.
- **Look:** minimal Liquid Glass. The backdrop is a blurred copy of the album cover, glass is used only on the search field, tabs and floating player bar, and the accent color comes from the cover art.
- **Type:** Zen Dots for the wordmark and titles, Inter for everything else.
- **Signature details:** a vinyl record with the cover spinning on its label, a dot-helix progress bar, and a flat-baseline wave volume bar.
- **Why it exists:** a CV project that shows a full stack end to end: server, database, streaming, client and deployment.

## Goals and CV value

**Product goals**

- Own your music: upload from any device, stream it back anywhere, with no subscription.
- Feel like a real app, not a website: installable on PC and phone, with media keys and lock-screen controls.
- Look clean and new, not like a generic AI template.
- Stay small: one feature at a time, each one finished before the next.

**What it shows on a CV**

- A real backend: authentication, file upload, SQLite database and HTTP range-request streaming.
- Deployment skills: Docker on your own hardware, remote access without open ports.
- Frontend craft: custom animation, audio handling and a designed UI system.
- Product thinking: a scoped plan, a design spec and a roadmap, not just code.

## Architecture

Stave is a client and server system. The server lives on the SER8 and owns the music, the database and the streaming. The client is a PWA (installable web app) that can later be wrapped in Electron for a real desktop program.

Diagram (in words): Stave client (PWA on PC and phone, Media Session controls) -> via Tailscale or Tunnel -> Beelink SER8 running Docker Compose: Node API and streaming (login, upload, tag reading, range-request streaming), which talks to SQLite (metadata, playlists, likes) and to the Music files (audio and cover art).

- **Server:** Node (Fastify or Express) with SQLite, reading tags and cover art with music-metadata.
- **Storage:** audio files on the SER8's disk, metadata and playlists in SQLite.
- **Streaming:** HTTP range requests, so seeking works and playback starts fast.
- **Auth:** a login so only you (and people you invite) can reach the library.
- **Packaging:** Docker Compose on the SER8.
- **Remote access:** Tailscale or a Cloudflare Tunnel, never raw open ports.
- **Client:** PWA with Media Session support for media keys and lock-screen controls; Electron wrapper optional later.
- **Sources:** music comes through pluggable sources, starting with your own uploaded files.

## Features

**In the first version**

- **Songs:** one library view with search, a hero header and a track list showing the playing track.
- **Liked Songs:** a built-in list of favorites.
- **Playlists:** a "+" next to the Playlists header creates one; they list in the sidebar.
- **Add song:** upload a file from your device, and it goes to the server.
- **Player bar:** play, pause, previous, next, shuffle, repeat, a time bar and a volume bar.
- **Lyrics tab:** a Songs | Lyrics switch; the lyrics view shows large synced lines next to a bigger vinyl.
- **Now playing:** a vinyl record with the cover art spinning on its label.

**Deliberately left out**

- Albums and Artists pages, to keep the app minimal.
- Social features, recommendations and podcasts.

**Possible later**

- Importing a whole folder.
- Streaming sources such as Spotify or another server.
- A real desktop wrapper with Electron.

## Design spec

Everything below is already built in the clickable mockup ("Stave Player Mockup"), at 1280 by 800.

**Look and materials**

- Neutral dark palette; the accent comes from the album cover (mockup default #ff8a5b, orange).
- The backdrop is the cover art, blurred heavily and darkened.
- Liquid Glass (backdrop blur) is used only on the search field, the Songs | Lyrics tabs and the floating player bar. No gradient washes, glow or emoji.

**Type**

- Zen Dots for the wordmark, album titles and the lyrics-view title.
- Inter for everything else.

**Layout**

- A 40px title bar with the logo, the "Stave" wordmark and window controls.
- A 232px sidebar: Songs (active), Liked Songs, a Playlists header with a "+" button, the playlist list, and an "Add song" button at the bottom.
- A main area with search and the Songs | Lyrics tabs, then either the album hero and track list or the lyrics view.
- A floating glass player bar at the bottom.

**Signature elements**

- **Vinyl:** a dark disc with grooves and a fixed light sheen; the cover spins on the label at 90 degrees per second (slowed down from the first version). It is 220px in Songs and 320px in Lyrics.
- **Dot-helix progress bar:** 16 columns of two dots each, a white dot and a dot in the accent color, moving in opposite phases, passing through each other like a loader. It is flipped horizontally from the reference and animated with JavaScript, because plain CSS keyframes did not run in the preview.
- **Wave volume bar:** bars with a flat baseline whose heights follow a sine envelope, tallest in the middle. Bars up to the volume level are lit white and move; the bar at the edge is the accent color; bars after it are flat dots.

**Logo**

An S made from a treble clef, traced from your reference image into a smooth vector (about 10 KB SVG). A hand-drawn vector version could replace the traced one for the final app icon.

## Tech stack and data model

**Stack**

- **Server:** Node.js with Fastify or Express.
- **Database:** SQLite.
- **Tags and cover art:** music-metadata reads ID3 tags and embedded covers on upload.
- **Streaming:** HTTP range requests so seeking works.
- **Client:** a PWA (HTML, CSS, JavaScript) using the Web Audio element and the Media Session API; the mockup's design carries over directly.
- **Deployment:** Docker Compose on the SER8, reached through Tailscale or a Cloudflare Tunnel.
- **Later:** an Electron wrapper for a real desktop program.

**Data model (first draft)**

- **users:** id, name, password hash.
- **tracks:** id, title, artist, album, year, duration, file path, cover path, uploaded by, uploaded at.
- **likes:** user id, track id.
- **playlists:** id, user id, name.
- **playlist_tracks:** playlist id, track id, position.
- **lyrics:** track id, text, optional timing per line.

This is a starting point, to be adjusted when each feature is built.

## Music sources and integrations

The server treats music as pluggable "sources", so the first one (your own files) does not block adding others later.

- **Your own files (v1):** upload from any device; the server stores the file and reads its tags.
- **OpenSubsonic / Navidrome:** a possible later source, since many existing libraries already speak that protocol.
- **Spotify:** possible but limited. As of the 2026 developer rules I found, development mode needs a Premium account, allows 5 authorized users, and playback only works through the Web Playback SDK in the browser. That means no raw audio, so the wave and helix visuals could not react to the music. Not re-verified today.
- **Lyrics:** LRCLIB is the planned free source for synced lyrics.
- **Metadata and covers:** MusicBrainz and the Cover Art Archive, for songs with missing tags. Not re-verified today.
- **Skipped:** Apple Music, YouTube Music and Tidal, which have no practical open playback path for a project like this.

## Build roadmap

Proposed order, one feature at a time, each one working before the next starts. Phases are in sequence, not scheduled to dates.

1. **Server and library:** project setup, upload endpoint, tag reading, SQLite.
2. **Streaming:** serve audio with range requests, test seeking.
3. **Player UI:** port the mockup into the real client with a working player bar.
4. **Accounts and playlists:** login, likes, playlists with the "+" button.
5. **Lyrics:** the Lyrics tab with synced lines.
6. **Deploy:** Docker Compose on the SER8, plus Tailscale or a tunnel.
7. **Polish:** PWA install, media keys, final logo; optionally Electron.

## Open decisions and next step

- **PWA or real desktop program?** A PWA installs from the browser and works on phone and PC; Electron makes a real .exe but is extra work. Suggested: PWA first, Electron later if you want it.
- **SER8 operating system:** Windows or Linux? This changes how Docker is set up.
- **Which "music libraries"?** Your own Spotify library, or music files you own? Spotify access is limited (see Music sources); owned files are the simple path.
- **Final logo:** keep the traced clef, or have a hand-drawn vector version made for the app icon.
- **Remote access:** Tailscale (private, simplest) or a Cloudflare Tunnel (public address).

**Next step:** answer the first two questions above, then start phase 1, the server with upload, tag reading and SQLite.

## CV write-up

Draft wording for the project entry. Edit it to match what is actually built once the project is done.

**Stave: self-hosted music streaming app** (Node.js, SQLite, Docker, PWA)

- Designed and built a self-hosted music player: users upload songs from any device to a server on a home mini PC and stream them back with seekable playback.
- Implemented the backend with Node.js and SQLite, including file upload, ID3 tag and cover art extraction, authentication and HTTP range-request streaming.
- Deployed with Docker Compose on a Beelink SER8, with private remote access through Tailscale.
- Built an installable PWA client with a custom animated UI (spinning vinyl, dot-helix progress bar, wave volume bar) and Media Session integration for media keys.

Only keep a bullet once it is true: the entry should describe what is built, not what is planned.
