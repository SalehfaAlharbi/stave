import * as api from '../api.js';
import { formatTime } from '../format.js';
import { currentLineIndex, stampLine } from '../lyrics-time.js';

const POLL_MS = 15_000;
const USER_SCROLL_HOLD_MS = 4000;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * The Lyrics view. Synced lyrics follow the song: the current line is in the
 * accent color, the others fade and blur with distance (as in the mockup),
 * and the list scrolls to keep the current line in the middle. Clicking a
 * line seeks to it. Songs without lyrics get "Add lyrics" (paste plain text
 * or LRC, or stamp lines while the song plays) and "Search LRCLIB again".
 */
export function createLyricsView({ root, player, toasts }) {
  const $ = (selector) => root.querySelector(selector);
  const scroller = $('.lyrics-scroll');
  const list = $('.lyrics-list');
  const status = $('.lyrics-status');
  const credit = $('.lyrics-credit');
  const tools = $('.lyrics-tools');
  const editButton = $('#lyrics-edit');
  const searchButton = $('#lyrics-search');
  const editor = $('.lyrics-editor');
  const textarea = $('#lyrics-text');
  const stampButton = $('#lyrics-stamp');
  const removeButton = $('#lyrics-remove');

  let track = null;
  let lyrics = null;
  let lineEls = [];
  let current = -2;
  let request = null;
  let pollTimer = null;
  let userScrolledAt = 0;

  const visible = () => !root.hidden;

  function showStatus(text, { actions = false } = {}) {
    status.textContent = text;
    status.hidden = !text;
    searchButton.hidden = !actions;
  }

  function render() {
    clearTimeout(pollTimer);
    current = -2;
    lineEls = [];
    list.replaceChildren();
    list.classList.toggle('is-synced', Boolean(lyrics?.synced));
    credit.hidden = lyrics?.source !== 'lrclib' || lyrics.status !== 'found';
    tools.hidden = !track || !editor.hidden; // a background refresh mustn't cover the open editor
    editButton.textContent = lyrics?.status === 'found' ? 'Edit lyrics' : 'Add lyrics';

    if (!track) return showStatus('Play a song to see its lyrics here.');
    if (!lyrics) return showStatus('');
    if (lyrics.status === 'pending') {
      pollTimer = setTimeout(() => load(track, { quiet: true }), POLL_MS);
      return showStatus('Looking for lyrics…');
    }
    if (lyrics.status === 'instrumental') return showStatus('Instrumental', { actions: true });
    if (lyrics.status !== 'found' || !lyrics.lines.length) return showStatus('No lyrics for this song yet.', { actions: true });

    showStatus('');
    lineEls = lyrics.lines.map((line) => {
      const el = document.createElement(lyrics.synced ? 'button' : 'p');
      el.className = `lyric${line.text ? '' : ' is-gap'}`;
      el.textContent = line.text || '• • •';
      if (lyrics.synced) {
        el.type = 'button';
        el.dataset.time = String(line.time);
        if (!line.text) el.setAttribute('aria-label', `Instrumental, ${formatTime(line.time)}`);
      }
      return el;
    });
    list.append(...lineEls);
    scroller.scrollTop = 0;
    sync(player.position, { jump: true });
  }

  async function load(nextTrack, { quiet = false } = {}) {
    request?.abort();
    clearTimeout(pollTimer);
    track = nextTrack;
    if (!quiet) {
      lyrics = null;
      closeEditor();
      render();
    }
    if (!track) return;
    request = new AbortController();
    try {
      lyrics = await api.getLyrics(track.id, { signal: request.signal });
    } catch (err) {
      if (err.name === 'AbortError') return;
      lyrics = null;
      render();
      showStatus(`Couldn't load the lyrics. ${err.message}`);
      return;
    }
    render();
  }

  /** Highlights the line for `position`; cheap enough to call every frame. */
  function sync(position, { jump = false } = {}) {
    if (!lyrics?.synced || !lineEls.length) return;
    const index = currentLineIndex(lyrics.lines, position);
    if (index === current && !jump) return;
    current = index;
    lineEls.forEach((el, i) => {
      el.classList.toggle('is-current', i === index);
      el.style.setProperty('--d', String(Math.abs(i - Math.max(index, 0))));
    });
    if (visible()) follow(jump);
  }

  // Keeps the current line in the middle, unless the user is reading ahead.
  function follow(jump) {
    if (!jump && Date.now() - userScrolledAt < USER_SCROLL_HOLD_MS) return;
    const el = lineEls[Math.max(current, 0)];
    if (!el) return;
    const top = el.offsetTop - scroller.clientHeight / 2 + el.offsetHeight / 2;
    scroller.scrollTo({ top, behavior: jump || reducedMotion.matches ? 'auto' : 'smooth' });
  }

  for (const type of ['wheel', 'touchmove', 'keydown']) {
    scroller.addEventListener(type, () => { userScrolledAt = Date.now(); }, { passive: true });
  }

  list.addEventListener('click', (event) => {
    const line = event.target.closest('.lyric[data-time]');
    if (!line || track?.id !== player.current?.id) return;
    player.seek(Number(line.dataset.time));
    if (!player.playing) player.play();
    userScrolledAt = 0;
  });

  // ---- Editing ----

  function openEditor() {
    editor.hidden = false;
    scroller.hidden = true;
    tools.hidden = true;
    textarea.value = lyrics?.status === 'found' ? lyrics.text : '';
    removeButton.hidden = lyrics?.status !== 'found';
    updateStampLabel();
    textarea.focus();
  }

  function closeEditor() {
    editor.hidden = true;
    scroller.hidden = false;
    tools.hidden = !track;
  }

  function updateStampLabel() {
    const label = `Stamp line at ${formatTime(player.position)}`;
    if (stampButton.textContent !== label) stampButton.textContent = label;
  }

  editButton.addEventListener('click', openEditor);
  $('#lyrics-cancel').addEventListener('click', () => {
    closeEditor();
    editButton.focus();
  });

  stampButton.addEventListener('click', () => {
    const { text, caret } = stampLine(textarea.value, textarea.selectionStart, player.position);
    textarea.value = text;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
  });

  editor.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!track) return;
    const text = textarea.value.trim();
    try {
      lyrics = text ? await api.saveLyrics(track.id, text) : await api.removeLyrics(track.id);
      closeEditor();
      render();
      toasts.show({ title: lyrics.synced ? 'Lyrics saved, synced to the song' : 'Lyrics saved', timeout: 3000 });
    } catch (err) {
      toasts.show({ title: "Couldn't save the lyrics", detail: err.message, error: true });
    }
  });

  removeButton.addEventListener('click', async () => {
    if (!track) return;
    try {
      lyrics = await api.removeLyrics(track.id);
      closeEditor();
      render();
    } catch (err) {
      toasts.show({ title: "Couldn't remove the lyrics", detail: err.message, error: true });
    }
  });

  searchButton.addEventListener('click', async () => {
    if (!track) return;
    searchButton.disabled = true;
    showStatus('Searching LRCLIB…');
    try {
      lyrics = await api.lookUpLyrics(track.id);
      render();
      if (lyrics.status === 'missing') toasts.show({ title: "LRCLIB doesn't have lyrics for this song", timeout: 4000 });
    } catch (err) {
      render();
      toasts.show({ title: "Couldn't search LRCLIB", detail: err.message, error: true });
    } finally {
      searchButton.disabled = false;
    }
  });

  return {
    load,
    sync,
    /** The view just became visible: jump to the current line without animating. */
    shown() {
      sync(player.position, { jump: true });
      if (!editor.hidden) updateStampLabel();
    },
    /** Keeps the stamp button's time current while the editor is open. */
    tick() {
      if (!editor.hidden) updateStampLabel();
    },
  };
}
