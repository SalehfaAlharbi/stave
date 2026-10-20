import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Player } from '../src/player.js';

/** Just enough of HTMLAudioElement to drive the Player without a browser. */
class FakeAudio extends EventTarget {
  paused = true;
  ended = false;
  currentTime = 0;
  duration = NaN;
  volume = 1;
  muted = false;
  src = '';
  preload = '';
  play() {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  finish() {
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event('ended'));
  }
  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
  load() {}
}

const tracks = [1, 2, 3].map((id) => ({ id, title: `T${id}`, duration: 100, streamUrl: `/api/tracks/${id}/stream` }));

function setup() {
  const audio = new FakeAudio();
  return { audio, player: new Player(audio) };
}

describe('Player', () => {
  test('plays the chosen song and moves on when it ends', () => {
    const { audio, player } = setup();
    player.playList(tracks, 0);
    assert.equal(audio.src, '/api/tracks/1/stream');
    assert.equal(player.playing, true);

    audio.finish();
    assert.equal(audio.src, '/api/tracks/2/stream');
    assert.equal(player.playing, true);
  });

  test('stops after the last song when repeat is off', () => {
    const { audio, player } = setup();
    player.playList(tracks, 2);
    audio.finish();
    assert.equal(player.current.id, 3);
    assert.equal(player.playing, false);
  });

  test('repeat all wraps to the first song; repeat one replays the same song', () => {
    const { audio, player } = setup();
    player.setRepeat('all');
    player.playList(tracks, 2);
    audio.finish();
    assert.equal(player.current.id, 1);

    player.setRepeat('one');
    audio.currentTime = 99;
    audio.finish();
    assert.equal(player.current.id, 1);
    assert.equal(audio.currentTime, 0);
    assert.equal(player.playing, true);
  });

  test('repeat cycles off, all, one', () => {
    const { player } = setup();
    const seen = [];
    for (let i = 0; i < 3; i++) {
      player.cycleRepeat();
      seen.push(player.repeat);
    }
    assert.deepEqual(seen, ['all', 'one', 'off']);
  });

  test('previous restarts the song after 3 seconds, otherwise goes back', () => {
    const { audio, player } = setup();
    player.playList(tracks, 1);
    audio.currentTime = 42;
    player.previous();
    assert.equal(player.current.id, 2);
    assert.equal(audio.currentTime, 0);

    player.previous();
    assert.equal(player.current.id, 1);
  });

  test('seek is clamped to the song', () => {
    const { audio, player } = setup();
    player.playList(tracks, 0);
    audio.duration = 99.4; // the browser's estimate
    player.seek(500);
    assert.equal(audio.currentTime, 100, 'trusts the duration the server measured');
    player.seek(-3);
    assert.equal(audio.currentTime, 0);
  });

  test('setting a volume above zero unmutes', () => {
    const { audio, player } = setup();
    player.toggleMute();
    assert.equal(audio.muted, true);
    player.setVolume(0.3);
    assert.equal(audio.muted, false);
    assert.equal(audio.volume, 0.3);
    player.setVolume(4);
    assert.equal(audio.volume, 1);
  });

  test('a blocked play() leaves the player paused without reporting a broken file', async () => {
    const { audio, player } = setup();
    audio.play = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    const errors = [];
    player.addEventListener('error', () => errors.push('error'));
    player.playList(tracks, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(player.playing, false);
    assert.deepEqual(errors, []);

    audio.dispatchEvent(new Event('error')); // a real media error is still reported
    assert.deepEqual(errors, ['error']);
  });

  test('remembers which list is playing', () => {
    const { player } = setup();
    player.playList(tracks, 0, { context: 'playlist:7' });
    assert.equal(player.context, 'playlist:7');
  });

  test('dropping the playing track moves on, or stops at the end', () => {
    const { audio, player } = setup();
    player.playList(tracks, 1);
    player.dropTrack(99); // not playing: nothing happens
    assert.equal(player.current.id, 2);
    player.dropTrack(2);
    assert.equal(player.current.id, 3);

    const seen = [];
    player.addEventListener('track', (event) => seen.push(event.detail));
    player.dropTrack(3);
    assert.equal(player.current, null);
    assert.equal(player.playing, false);
    assert.deepEqual(seen, [null]);
    assert.equal(audio.src, '', 'nothing left loading the deleted file');
  });

  test('emits a track event for every new song', () => {
    const { audio, player } = setup();
    const seen = [];
    player.addEventListener('track', (event) => seen.push(event.detail.id));
    player.playList(tracks, 0);
    player.next();
    audio.finish();
    assert.deepEqual(seen, [1, 2, 3]);
  });
});
