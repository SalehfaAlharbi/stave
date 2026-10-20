import { formatTime } from '../format.js';

/**
 * The song list. A click anywhere on a row plays it; the title is a real
 * button for keyboards, and the heart and "more" buttons sit beside it (a
 * button can't hold other buttons). All tag text goes in with textContent:
 * tags come from uploaded files, so they are never treated as HTML.
 */
export function createTracklist(listEl, template, { onPlay, onLike, onMore }) {
  let tracks = [];
  let currentId = null;
  const rows = new Map();

  listEl.addEventListener('click', (event) => {
    const row = event.target.closest('li.row');
    if (!row) return;
    const track = tracks[Number(row.dataset.index)];
    if (event.target.closest('.row-like')) onLike(track);
    else if (event.target.closest('.row-more')) onMore(track, event.target.closest('.row-more'));
    else onPlay(tracks, Number(row.dataset.index));
  });

  function setCurrentRow(li, on) {
    li?.classList.toggle('is-current', on);
    li?.querySelector('.row-play').toggleAttribute('aria-current', on);
  }

  function paintLike(li, track) {
    const button = li.querySelector('.row-like');
    button.setAttribute('aria-pressed', String(track.liked));
    button.setAttribute('aria-label', `${track.liked ? 'Remove from' : 'Add to'} Liked Songs: ${track.title}`);
  }

  return {
    get tracks() {
      return tracks;
    },

    render(next) {
      tracks = next;
      rows.clear();
      const fragment = document.createDocumentFragment();
      tracks.forEach((track, i) => {
        const li = template.content.firstElementChild.cloneNode(true);
        li.dataset.index = String(i);
        li.querySelector('.num').textContent = String(i + 1);
        li.querySelector('.row-title').textContent = track.title;
        li.querySelector('.row-artist').textContent = track.artist ?? 'Unknown artist';
        li.querySelector('.row-time').textContent = formatTime(track.duration);
        li.querySelector('.row-more').setAttribute('aria-label', `More for ${track.title}`);
        paintLike(li, track);
        rows.set(track.id, li);
        fragment.append(li);
      });
      listEl.replaceChildren(fragment);
      setCurrentRow(rows.get(currentId), true);
    },

    markCurrent(id) {
      setCurrentRow(rows.get(currentId), false);
      currentId = id;
      setCurrentRow(rows.get(currentId), true);
    },

    /** Repaints one track's heart after a like or unlike. */
    updateLike(track) {
      const li = rows.get(track.id);
      if (li) paintLike(li, track);
    },
  };
}
