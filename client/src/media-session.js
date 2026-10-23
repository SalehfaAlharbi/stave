// Media Session: tells the operating system what's playing, and lets it
// control the player. That's what makes keyboard media keys, Windows' media
// controls, phone lock screens and headphone buttons work, including when
// Stave isn't the focused window or tab.

const COVER_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const POSITION_EVERY_MS = 5000; // the OS extrapolates in between

export function connectMediaSession(player) {
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;

  const handlers = {
    play: () => player.play(),
    pause: () => player.pause(),
    stop: () => player.pause(),
    previoustrack: () => player.previous(),
    nexttrack: () => player.next(),
    seekto: (details) => player.seek(details.seekTime),
    seekbackward: (details) => player.seek(player.position - (details.seekOffset ?? 10)),
    seekforward: (details) => player.seek(player.position + (details.seekOffset ?? 10)),
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // an action this browser doesn't know
    }
  }

  let lastPosition = 0;
  function updatePosition(force = false) {
    const duration = player.duration;
    if (!player.current || !(duration > 0)) return;
    if (!force && Date.now() - lastPosition < POSITION_EVERY_MS) return;
    lastPosition = Date.now();
    try {
      session.setPositionState({ duration, position: Math.min(player.position, duration), playbackRate: 1 });
    } catch {
      // position briefly past a just-shortened duration
    }
  }

  player.addEventListener('track', ({ detail: track }) => {
    if (!track) {
      session.metadata = null;
      session.playbackState = 'none';
      return;
    }
    const type = COVER_TYPES[track.coverUrl?.split('.').pop()];
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist ?? '',
      album: track.album ?? '',
      artwork: track.coverUrl ? [{ src: new URL(track.coverUrl, location.href).href, ...(type ? { type } : {}) }] : [],
    });
    updatePosition(true);
  });

  player.addEventListener('state', () => {
    session.playbackState = player.playing ? 'playing' : player.current ? 'paused' : 'none';
    updatePosition(true);
  });

  player.addEventListener('time', () => updatePosition());
}
