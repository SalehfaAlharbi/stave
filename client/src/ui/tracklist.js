import { formatTime } from '../format.js';

/**
 * The song list. Rows are real buttons (click or Enter plays), and all tag
 * text goes in with textContent: tags come from uploaded files, so they are
 * never treated as HTML.
 */
export function createTracklist(listEl, template, { onPlay }) {
  let tracks = [];
  let currentId = null;
  const rows = new Map();

  listEl.addEventListener('click', (event) => {
    const button = event.target.closest('button.row');
    if (button) onPlay(tracks, Number(button.dataset.index));
  });

  function setCurrentRow(li, on) {
    li?.classList.toggle('is-current', on);
    if (li) li.querySelector('.row').toggleAttribute('aria-current', on);
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
        li.querySelector('.row').dataset.index = String(i);
        li.querySelector('.num').textContent = String(i + 1);
        li.querySelector('.row-title').textContent = track.title;
        li.querySelector('.row-artist').textContent = track.artist ?? 'Unknown artist';
        li.querySelector('.row-time').textContent = formatTime(track.duration);
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
  };
}
