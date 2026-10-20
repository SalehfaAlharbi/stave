import { accentFromImage } from '../accent.js';

const PLACEHOLDER_COVER = '/assets/cover-placeholder.svg';

/**
 * Everything that follows the current song: the hero, both vinyls, the
 * player bar's cover and titles, the lyrics view's titles, the blurred
 * backdrop and the accent color.
 */
export function createNowPlaying(doc) {
  const $ = (selector) => doc.querySelector(selector);
  const template = $('#vinyl-template');
  for (const vinyl of doc.querySelectorAll('.vinyl')) vinyl.append(template.content.cloneNode(true));

  const coverImages = [...doc.querySelectorAll('.vinyl-label img'), $('#player-cover')];
  const backdrop = $('.backdrop-art');
  let shownCover = null;
  let accentRequest = 0;

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
    /** Shows `track`, or the library summary when nothing is playing. */
    update(track, { summary }) {
      setCover(track?.coverUrl ?? null);
      if (!track) {
        setText('#hero-kicker', 'Library');
        setText('#hero-title', 'Songs');
        setText('#hero-meta', summary);
        setText('#player-title', 'Nothing playing');
        setText('#player-artist', null);
        setText('#lyrics-title', 'Nothing playing');
        setText('#lyrics-artist', null);
        doc.title = 'Stave';
        return;
      }
      const artist = track.artist ?? 'Unknown artist';
      // Album titles are the display type (Zen Dots); the song then goes in the line below.
      setText('#hero-kicker', 'Now playing');
      setText('#hero-title', track.album ?? track.title);
      setText('#hero-meta', [track.album ? track.title : null, artist, track.year].filter(Boolean).join(' · '));
      setText('#player-title', track.title);
      setText('#player-artist', artist);
      setText('#lyrics-title', track.title);
      setText('#lyrics-artist', artist);
      doc.title = `${track.title} · ${artist} — Stave`;
    },
  };
}
