import { listTracks } from './api.js';
import { formatTime, formatTotal, pluralize } from './format.js';
import { Player } from './player.js';
import { createHelix } from './ui/helix.js';
import { createNowPlaying } from './ui/nowplaying.js';
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
const toasts = createToasts($('#toasts'));
const nowPlaying = createNowPlaying(document);
const tracklist = createTracklist($('#tracklist'), $('#row-template'), { onPlay: playFrom });

let visible = []; // the list on screen (all songs, or search results)
let query = '';
let request;

// ---- Library ---------------------------------------------------------------

function librarySummary() {
  if (!visible.length) return query ? 'No matches' : 'No songs yet';
  const total = visible.reduce((sum, track) => sum + (track.duration ?? 0), 0);
  return `${pluralize(visible.length, 'song')}, ${formatTotal(total)}`;
}

function showListMessage(text) {
  const message = $('#list-message');
  message.textContent = text ?? '';
  message.hidden = !text;
  $('#list-head').hidden = Boolean(text);
}

async function refresh() {
  request?.abort();
  request = new AbortController();
  try {
    visible = await listTracks(query, { signal: request.signal });
  } catch (err) {
    if (err.name === 'AbortError') return;
    visible = [];
    tracklist.render([]);
    showListMessage(`Can't reach the Stave server. ${err.message}`);
    return;
  }
  tracklist.render(visible);
  if (!visible.length) {
    showListMessage(query
      ? `No songs match "${query}".`
      : 'Your library is empty. Use Add song, or drop audio files anywhere on this window.');
  } else {
    showListMessage(null);
  }
  if (!player.current) nowPlaying.update(null, { summary: librarySummary() });
}

let searchTimer;
$('#search').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = event.target.value;
    refresh();
  }, 150);
});
$('#search').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && event.target.value) {
    event.target.value = '';
    query = '';
    refresh();
  }
});

// ---- Playing ---------------------------------------------------------------

function playFrom(tracks, index) {
  if (tracks[index]?.id === player.current?.id) player.toggle();
  else player.playList(tracks, index);
}

$('#hero-play').addEventListener('click', () => {
  if (player.current) player.toggle();
  else if (visible.length) player.playList(visible, 0);
});
$('#hero-shuffle').addEventListener('click', () => {
  if (!visible.length) return;
  player.setShuffle(true);
  player.playList(visible, Math.floor(Math.random() * visible.length));
});
$('#btn-play').addEventListener('click', () => {
  if (player.current) player.toggle();
  else if (visible.length) player.playList(visible, 0);
});
$('#btn-prev').addEventListener('click', () => player.previous());
$('#btn-next').addEventListener('click', () => player.next());
$('#btn-shuffle').addEventListener('click', () => player.setShuffle(!player.shuffle));
$('#btn-repeat').addEventListener('click', () => player.cycleRepeat());
$('#btn-mute').addEventListener('click', () => player.toggleMute());

// Space plays and pauses, unless you're typing or on a control that uses it.
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat) return;
  if (event.target.closest('input, textarea, select, button, [role="slider"], [role="tab"], [contenteditable]')) return;
  event.preventDefault();
  $('#btn-play').click();
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

const PLAY_LABELS = { true: 'Pause', false: 'Play' };

player.addEventListener('track', ({ detail: track }) => {
  nowPlaying.update(track, { summary: librarySummary() });
  tracklist.markCurrent(track.id);
  helix.setEnabled(true);
  updateTime();
});

player.addEventListener('state', () => {
  const playing = player.playing;
  document.body.classList.toggle('is-playing', playing);
  $('#btn-play').setAttribute('aria-label', PLAY_LABELS[playing]);
  $('#hero-play-label').textContent = PLAY_LABELS[playing];
  syncAnimation();
  updateTime();
});

player.addEventListener('time', updateTime);

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
  onAdded: () => refresh(),
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
nowPlaying.update(null, { summary: '' });
refresh();
