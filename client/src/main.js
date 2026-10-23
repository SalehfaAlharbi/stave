import * as api from './api.js';
import { formatTime, formatTotal, pluralize } from './format.js';
import { connectMediaSession } from './media-session.js';
import { Player } from './player.js';
import { authenticate } from './ui/auth.js';
import { openDialog } from './ui/dialog.js';
import { createHelix } from './ui/helix.js';
import { createLyricsView } from './ui/lyrics.js';
import { openMenu } from './ui/menu.js';
import { createNowPlaying } from './ui/nowplaying.js';
import { createSidebar } from './ui/sidebar.js';
import { createToasts } from './ui/toasts.js';
import { createTracklist } from './ui/tracklist.js';
import { createUploader } from './ui/upload.js';
import { createWave } from './ui/wave.js';

const $ = (selector) => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SETTINGS_KEY = 'stave.settings';

// Per-browser conveniences only; nothing here has to survive.
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
}
function saveSettings() {
  try {
    const { volume, muted } = player.audio;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ volume, muted, shuffle: player.shuffle, repeat: player.repeat }));
  } catch {
    // storage blocked or full: settings just won't be remembered
  }
}

const player = new Player(new Audio());
connectMediaSession(player);
const toasts = createToasts($('#toasts'));
const nowPlaying = createNowPlaying(document);
const lyricsView = createLyricsView({ root: $('#view-lyrics'), player, toasts });
const tracklist = createTracklist($('#tracklist'), $('#row-template'), {
  onPlay: playFrom,
  onLike: toggleLike,
  onMore: showTrackMenu,
});
const sidebar = createSidebar({
  list: $('#playlist-nav'),
  addButton: $('#new-playlist'),
  form: $('#new-playlist-form'),
  onCreate: async (name) => {
    try {
      const playlist = await api.createPlaylist(name);
      await refreshPlaylists();
      location.hash = `#/playlist/${playlist.id}`;
    } catch (err) {
      fail("Couldn't create the playlist", err);
    }
  },
});

let user = null;
let playlists = [];
let view = { type: 'songs', key: 'songs' };
let header = { kicker: 'Library', title: 'Songs' };
let visible = []; // the list on screen
let query = '';
let request;

function fail(title, err) {
  toasts.show({ title, detail: err.message, error: true });
}

// ---- Views: #/ (songs), #/liked, #/playlist/<id> -------------------------------

function parseHash() {
  const match = location.hash.match(/^#\/playlist\/(\d+)$/);
  if (match) return { type: 'playlist', id: Number(match[1]), key: `playlist:${match[1]}` };
  if (location.hash === '#/liked') return { type: 'liked', key: 'liked' };
  return { type: 'songs', key: 'songs' };
}

function summary(tracks) {
  if (!tracks.length) return query && view.type === 'songs' ? 'No matches' : 'No songs yet';
  const total = tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
  return `${pluralize(tracks.length, 'song')}, ${formatTotal(total)}`;
}

const EMPTY = {
  songs: 'Your library is empty. Use Add song, or drop audio files anywhere on this window.',
  liked: 'Songs you like show up here. Use the heart next to any song.',
  playlist: 'This playlist is empty. Add songs with the "…" button next to any song.',
};

function showListMessage(text) {
  $('#list-message').textContent = text ?? '';
  $('#list-message').hidden = !text;
  $('#list-head').hidden = Boolean(text);
}

function renderView() {
  $('#hero-kicker').textContent = header.kicker;
  $('#hero-title').textContent = header.title;
  $('#hero-meta').textContent = summary(visible);
  $('#hero-more').hidden = view.type !== 'playlist';
  $('#hero-play').disabled = $('#hero-shuffle').disabled = !visible.length;
  tracklist.render(visible);
  tracklist.markCurrent(player.current?.id ?? null);
  if (visible.length) showListMessage(null);
  else showListMessage(view.type === 'songs' && query ? `No songs match "${query}".` : EMPTY[view.type]);
  nowPlaying.setIdleCover(visible.find((track) => track.coverUrl)?.coverUrl);
  syncHeroPlay();
}

async function loadView() {
  view = parseHash();
  if (view.type !== 'songs' && query) {
    query = '';
    $('#search').value = '';
  }
  sidebar.setActive(view.key);
  document.body.classList.remove('nav-open');
  $('#nav-toggle').setAttribute('aria-expanded', 'false');

  request?.abort();
  request = new AbortController();
  const { signal } = request;
  try {
    if (view.type === 'songs') {
      visible = await api.listTracks(query, { signal });
      header = { kicker: query ? 'Search' : 'Library', title: 'Songs' };
    } else if (view.type === 'liked') {
      visible = await api.likedTracks({ signal });
      header = { kicker: 'Playlist', title: 'Liked Songs' };
    } else {
      const playlist = await api.getPlaylist(view.id, { signal });
      visible = playlist.tracks;
      view.name = playlist.name;
      header = { kicker: 'Playlist', title: playlist.name };
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (err.status === 404 && view.type === 'playlist') {
      toasts.show({ title: 'That playlist no longer exists.' });
      location.hash = '#/';
      return;
    }
    visible = [];
    tracklist.render([]);
    showListMessage(`Can't reach the Stave server. ${err.message}`);
    return;
  }
  renderView();
}

async function refreshPlaylists() {
  try {
    playlists = await api.listPlaylists();
    sidebar.render(playlists);
  } catch (err) {
    fail("Couldn't load your playlists", err);
  }
}

window.addEventListener('hashchange', loadView);

let searchTimer;
$('#search').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = event.target.value.trim();
    // Search covers the whole library, so it opens the Songs view.
    if (view.type !== 'songs') location.hash = '#/';
    else loadView();
  }, 150);
});
$('#search').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && event.target.value) {
    event.target.value = '';
    query = '';
    loadView();
  }
});

// Phone: the sidebar becomes a drawer.
$('#nav-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  $('#nav-toggle').setAttribute('aria-expanded', String(open));
});
$('#nav-scrim').addEventListener('click', () => {
  document.body.classList.remove('nav-open');
  $('#nav-toggle').setAttribute('aria-expanded', 'false');
});

// ---- Playing ---------------------------------------------------------------

function playFrom(tracks, index) {
  if (tracks[index]?.id === player.current?.id && player.context === view.key) player.toggle();
  else player.playList(tracks, index, { context: view.key });
}

function syncHeroPlay() {
  const pausing = player.context === view.key && player.playing;
  $('#hero-play').classList.toggle('is-pausing', pausing);
  $('#hero-play-label').textContent = pausing ? 'Pause' : 'Play';
}

$('#hero-play').addEventListener('click', () => {
  if (player.context === view.key && player.current) player.toggle();
  else if (visible.length) player.playList(visible, 0, { context: view.key });
});
$('#hero-shuffle').addEventListener('click', () => {
  if (!visible.length) return;
  player.setShuffle(true);
  player.playList(visible, Math.floor(Math.random() * visible.length), { context: view.key });
});
$('#btn-play').addEventListener('click', () => {
  if (player.current) player.toggle();
  else if (visible.length) player.playList(visible, 0, { context: view.key });
});
$('#btn-prev').addEventListener('click', () => player.previous());
$('#btn-next').addEventListener('click', () => player.next());
$('#btn-shuffle').addEventListener('click', () => player.setShuffle(!player.shuffle));
$('#btn-repeat').addEventListener('click', () => player.cycleRepeat());
$('#btn-mute').addEventListener('click', () => player.toggleMute());

// Space plays and pauses, unless you're typing or on a control that uses it.
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || document.body.classList.contains('is-signed-out')) return;
  if (event.target.closest('input, textarea, select, button, a, [role="slider"], [role="tab"], dialog, [popover]')) return;
  event.preventDefault();
  $('#btn-play').click();
});

// ---- Likes, playlists and deleting ------------------------------------------------

async function toggleLike(track) {
  const liked = !track.liked;
  track.liked = liked;
  tracklist.updateLike(track);
  try {
    await (liked ? api.like(track.id) : api.unlike(track.id));
  } catch (err) {
    track.liked = !liked;
    tracklist.updateLike(track);
    fail("Couldn't update Liked Songs", err);
    return;
  }
  if (player.current?.id === track.id) player.current.liked = liked;
  if (view.type === 'liked' && !liked) {
    visible = visible.filter((t) => t.id !== track.id);
    renderView();
  }
}

async function addToPlaylist(playlist, track) {
  try {
    await api.addToPlaylist(playlist.id, track.id);
    toasts.show({ title: `Added to "${playlist.name}"`, detail: track.title, timeout: 3000 });
  } catch (err) {
    if (err.status === 409) toasts.show({ title: err.message, timeout: 3000 });
    else fail("Couldn't add the song", err);
  }
}

async function addToNewPlaylist(track) {
  const name = await openDialog({ title: 'New playlist', input: { label: 'Name' }, confirm: 'Create' });
  if (!name) return;
  try {
    const playlist = await api.createPlaylist(name);
    await addToPlaylist(playlist, track);
    await refreshPlaylists();
  } catch (err) {
    fail("Couldn't create the playlist", err);
  }
}

async function removeFromPlaylist(track) {
  try {
    await api.removeFromPlaylist(view.id, track.id);
    visible = visible.filter((t) => t.id !== track.id);
    renderView();
  } catch (err) {
    fail("Couldn't remove the song", err);
  }
}

async function deleteFromLibrary(track) {
  const ok = await openDialog({
    title: `Delete "${track.title}"?`,
    message: "It's removed from the library for everyone, including their playlists and Liked Songs, and the file is deleted from the server.",
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteTrack(track.id);
    player.dropTrack(track.id);
    await loadView();
  } catch (err) {
    fail("Couldn't delete the song", err);
  }
}

function showTrackMenu(track, button) {
  const others = playlists.filter((p) => !(view.type === 'playlist' && p.id === view.id));
  const items = [
    { heading: 'Add to playlist' },
    ...others.map((playlist) => ({ label: playlist.name, onSelect: () => addToPlaylist(playlist, track) })),
    { label: 'New playlist…', onSelect: () => addToNewPlaylist(track) },
  ];
  if (view.type === 'playlist') items.push({ label: 'Remove from this playlist', onSelect: () => removeFromPlaylist(track) });
  if (user.isAdmin || track.uploadedBy === user.id) {
    items.push({ label: 'Delete from library…', danger: true, onSelect: () => deleteFromLibrary(track) });
  }
  openMenu(button, items, { label: `Options for ${track.title}` });
}

$('#hero-more').addEventListener('click', (event) => {
  if (view.type !== 'playlist') return;
  const { id, name } = view;
  openMenu(event.currentTarget, [
    {
      label: 'Rename…',
      onSelect: async () => {
        const next = await openDialog({ title: 'Rename playlist', input: { label: 'Name', value: name }, confirm: 'Save' });
        if (!next || next === name) return;
        try {
          await api.renamePlaylist(id, next);
          await refreshPlaylists();
          await loadView();
        } catch (err) {
          fail("Couldn't rename the playlist", err);
        }
      },
    },
    {
      label: 'Delete playlist…',
      danger: true,
      onSelect: async () => {
        const ok = await openDialog({
          title: `Delete "${name}"?`,
          message: 'The songs stay in your library.',
          confirm: 'Delete',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.deletePlaylist(id);
          await refreshPlaylists();
          location.hash = '#/';
        } catch (err) {
          fail("Couldn't delete the playlist", err);
        }
      },
    },
  ], { label: `Options for ${name}` });
});

// ---- Account ---------------------------------------------------------------------

$('#account').addEventListener('click', (event) => {
  const items = [{ heading: `Signed in as ${user.name}` }];
  if (user.isAdmin) {
    items.push({
      label: 'Invite someone…',
      onSelect: async () => {
        try {
          const { url } = await api.createInvite();
          await openDialog({
            title: 'Invite someone',
            message: 'Send them this link. It works once and expires in 7 days.',
            input: { label: 'Invite link', value: new URL(url, location.origin).href, readOnly: true, maxLength: 500 },
            confirm: 'Done',
            cancel: null,
            copy: true,
          });
        } catch (err) {
          fail("Couldn't create an invite", err);
        }
      },
    });
  }
  items.push({
    label: 'Sign out',
    onSelect: async () => {
      player.pause();
      await api.signOut().catch(() => {});
      location.assign('/');
    },
  });
  openMenu(event.currentTarget, items, { label: 'Account' });
});

// A session that ends while the app is open (expired, or signed out elsewhere).
let signingOut = false;
window.addEventListener(api.SIGNED_OUT, () => {
  if (signingOut) return;
  signingOut = true;
  player.pause();
  location.reload();
});

// ---- Progress (dot helix) and volume (wave) ----------------------------------

const timeNow = $('#time-current');
const timeTotal = $('#time-total');

const helix = createHelix($('#helix'), {
  onScrub: (fraction) => { timeNow.textContent = formatTime(fraction * player.duration); },
  onSeek: (fraction) => player.seek(fraction * player.duration),
  onStep: (seconds) => player.seek(player.position + seconds),
});

const wave = createWave($('#wave'), {
  onChange: (volume) => player.setVolume(volume),
});

function updateTime() {
  const duration = player.duration;
  const position = player.position;
  if (!helix.scrubbing) timeNow.textContent = formatTime(position);
  timeTotal.textContent = formatTime(duration);
  helix.setProgress(duration ? position / duration : 0, {
    now: position,
    max: duration,
    label: `${formatTime(position)} of ${formatTime(duration)}`,
  });
}

// One animation loop for both bars, running only while music plays.
let frame = 0;
function tick(ms) {
  if (player.duration) helix.setFraction(player.position / player.duration);
  helix.render(ms / 1000);
  wave.render(ms / 1000);
  lyricsView.sync(player.position);
  lyricsView.tick();
  frame = requestAnimationFrame(tick);
}
function syncAnimation() {
  const run = player.playing && !reducedMotion.matches;
  if (run && !frame) frame = requestAnimationFrame(tick);
  if (!run && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  wave.setMoving(run);
}
reducedMotion.addEventListener('change', syncAnimation);

// ---- Reacting to the player --------------------------------------------------

player.addEventListener('track', ({ detail: track }) => {
  nowPlaying.update(track);
  lyricsView.load(track);
  tracklist.markCurrent(track?.id ?? null);
  helix.setEnabled(Boolean(track));
  updateTime();
});

player.addEventListener('state', () => {
  const playing = player.playing;
  document.body.classList.toggle('is-playing', playing);
  $('#btn-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  syncHeroPlay();
  syncAnimation();
  updateTime();
});

// The animation loop syncs lyrics every frame while playing; this covers seeks
// while paused and reduced-motion mode, where the loop doesn't run.
player.addEventListener('time', () => {
  updateTime();
  lyricsView.sync(player.position);
  lyricsView.tick();
});

player.addEventListener('volume', () => {
  const { volume, muted } = player.audio;
  wave.setVolume(muted ? 0 : volume);
  $('#btn-mute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  $('#btn-mute').classList.toggle('is-muted', muted || volume === 0);
  saveSettings();
});

player.addEventListener('modes', () => {
  $('#btn-shuffle').setAttribute('aria-pressed', String(player.shuffle));
  const repeat = $('#btn-repeat');
  repeat.setAttribute('aria-pressed', String(player.repeat !== 'off'));
  repeat.setAttribute('aria-label', { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this song' }[player.repeat]);
  repeat.classList.toggle('is-one', player.repeat === 'one');
  saveSettings();
});

player.addEventListener('error', ({ detail }) => {
  toasts.show({
    title: `Can't play "${detail.track.title}"`,
    detail: 'The file may be damaged or in a format this browser does not support.',
    error: true,
  });
});

// ---- Views (Songs | Lyrics) --------------------------------------------------

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
  }
  if (tab.id === 'tab-lyrics') lyricsView.shown();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    selectTab(next);
    next.focus();
  });
}

// ---- Uploads -----------------------------------------------------------------

createUploader({
  input: $('#file-input'),
  triggers: document.querySelectorAll('[data-add-song]'),
  overlay: $('#drop-overlay'),
  toasts,
  onAdded: () => {
    if (view.type === 'songs') loadView();
  },
});

// ---- Start -------------------------------------------------------------------

const settings = loadSettings();
player.audio.volume = typeof settings.volume === 'number' ? settings.volume : 0.5;
player.audio.muted = settings.muted === true;
player.shuffle = settings.shuffle === true;
player.setRepeat(settings.repeat ?? 'off');
player.emit('volume');
player.emit('state');
helix.setEnabled(false);
updateTime();
nowPlaying.update(null);
lyricsView.load(null);

async function boot() {
  try {
    user = await authenticate();
  } catch {
    document.body.classList.add('is-signed-out');
    $('#auth').hidden = false;
    $('#auth-intro').textContent = "Can't reach the Stave server. Check that it's running, then reload.";
    $('#auth form').hidden = true;
    return;
  }
  document.body.classList.remove('is-signed-out');
  $('#account-initial').textContent = user.name.slice(0, 1).toUpperCase();
  $('#account').setAttribute('aria-label', `Account: ${user.name}`);
  await Promise.all([refreshPlaylists(), loadView()]);
}

boot();
