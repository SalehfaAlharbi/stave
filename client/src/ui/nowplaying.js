import { accentFromImage } from '../accent.js';

const PLACEHOLDER_COVER = '/assets/cover-placeholder.svg';

/**
 * Everything that follows the current song: both vinyls, the player bar's
 * cover and titles, the lyrics view's titles, the blurred backdrop, the
 * accent color and the tab title. With nothing playing, the vinyl shows the
 * cover of the first song on screen.
 */
export function createNowPlaying(doc) {
  const $ = (selector) => doc.querySelector(selector);
  const template = $('#vinyl-template');
  for (const vinyl of doc.querySelectorAll('.vinyl')) vinyl.append(template.content.cloneNode(true));

  const coverImages = [...doc.querySelectorAll('.vinyl-label img'), $('#player-cover')];
  const backdrop = $('.backdrop-art');
  let shownCover = null;
  let accentRequest = 0;
  let current = null;
  let idleCover = null;

  function setText(selector, text) {
    const el = $(selector);
    el.textContent = text ?? '';
    el.hidden = !text;
  }

  function setCover(url) {
    const src = url ?? PLACEHOLDER_COVER;
    if (src === shownCover) return;
    shownCover = src;
    for (const img of coverImages) img.src = src;

    // Crossfade the backdrop: the new cover fades in over the old one, then
    // the old layers go. Not driven by requestAnimationFrame, which browsers
    // pause in background tabs, and transitionend is backed by a timer.
    const layer = new Image();
    layer.alt = '';
    layer.decoding = 'async';
    layer.addEventListener('load', () => {
      backdrop.append(layer);
      void layer.offsetWidth; // flush styles so the opacity change transitions
      layer.classList.add('is-visible');
      const dropOlder = () => {
        while (layer.isConnected && backdrop.firstElementChild !== layer) backdrop.firstElementChild.remove();
      };
      layer.addEventListener('transitionend', dropOlder, { once: true });
      setTimeout(dropOlder, 1500);
    }, { once: true });
    layer.src = src;

    const request = ++accentRequest;
    accentFromImage(url).then((accent) => {
      if (request === accentRequest) doc.documentElement.style.setProperty('--accent', accent);
    });
  }

  return {
    update(track) {
      current = track;
      setCover(track?.coverUrl ?? idleCover);
      if (!track) {
        setText('#player-title', 'Nothing playing');
        setText('#player-artist', null);
        setText('#lyrics-title', 'Nothing playing');
        setText('#lyrics-artist', null);
        doc.title = 'Stave';
        return;
      }
      const artist = track.artist ?? 'Unknown artist';
      setText('#player-title', track.title);
      setText('#player-artist', artist);
      setText('#lyrics-title', track.title);
      setText('#lyrics-artist', artist);
      doc.title = `${track.title} · ${artist} — Stave`;
    },

    /** The cover to show while nothing plays (the first song of the open list). */
    setIdleCover(url) {
      idleCover = url ?? null;
      if (!current) setCover(idleCover);
    },
  };
}
