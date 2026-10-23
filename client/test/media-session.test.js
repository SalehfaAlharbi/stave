import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { connectMediaSession } from '../src/media-session.js';
import { Player } from '../src/player.js';

// Just enough of the browser: an audio element, navigator.mediaSession and MediaMetadata.
class FakeAudio extends EventTarget {
  paused = true;
  ended = false;
  currentTime = 0;
  duration = NaN;
  volume = 1;
  muted = false;
  src = '';
  play() {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  removeAttribute() {}
  load() {}
}

let session;
beforeEach(() => {
  session = { handlers: {}, metadata: null, playbackState: 'none', positions: [] };
  session.setActionHandler = (action, handler) => { session.handlers[action] = handler; };
  session.setPositionState = (state) => session.positions.push(state);
  Object.defineProperty(globalThis, 'navigator', { value: { mediaSession: session }, configurable: true });
  globalThis.MediaMetadata = class { constructor(init) { Object.assign(this, init); } };
  globalThis.location = { href: 'http://stave.test/' };
});

const tracks = [1, 2].map((id) => ({
  id, title: `Song ${id}`, artist: 'Band', album: 'Record', duration: 100,
  streamUrl: `/api/tracks/${id}/stream`, coverUrl: id === 1 ? `/api/covers/${'a'.repeat(64)}.png` : null,
}));

describe('Media Session', () => {
  test('tells the OS what is playing, with an absolute cover URL', () => {
    const player = new Player(new FakeAudio());
    connectMediaSession(player);
    player.playList(tracks, 0);

    assert.equal(session.metadata.title, 'Song 1');
    assert.equal(session.metadata.artist, 'Band');
    assert.equal(session.metadata.album, 'Record');
    assert.deepEqual(session.metadata.artwork, [{ src: `http://stave.test/api/covers/${'a'.repeat(64)}.png`, type: 'image/png' }]);
    assert.equal(session.playbackState, 'playing');
    assert.deepEqual(session.positions.at(-1), { duration: 100, position: 0, playbackRate: 1 });

    player.pause();
    assert.equal(session.playbackState, 'paused');
  });

  test('media keys and OS buttons drive the player', () => {
    const audio = new FakeAudio();
    const player = new Player(audio);
    connectMediaSession(player);
    player.playList(tracks, 0);

    session.handlers.pause();
    assert.equal(player.playing, false);
    session.handlers.play();
    assert.equal(player.playing, true);
    session.handlers.nexttrack();
    assert.equal(player.current.id, 2);
    assert.deepEqual(session.metadata.artwork, [], 'a song without a cover');
    session.handlers.previoustrack();
    assert.equal(player.current.id, 1);
    session.handlers.seekto({ seekTime: 42 });
    assert.equal(audio.currentTime, 42);
    session.handlers.seekbackward({});
    assert.equal(audio.currentTime, 32, '10 s back by default');
  });

  test('does nothing where the browser has no Media Session', () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    assert.doesNotThrow(() => connectMediaSession(new Player(new FakeAudio())));
  });
});
