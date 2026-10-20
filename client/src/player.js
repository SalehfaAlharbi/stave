import { clamp } from './format.js';
import { Queue } from './queue.js';

const REPEAT_MODES = ['off', 'all', 'one'];
const RESTART_THRESHOLD = 3; // seconds: "previous" restarts the song after this

/**
 * Playback: one audio element plus a queue. The server's range requests do
 * the heavy lifting; setting `src` and `currentTime` is all seeking needs.
 *
 * Events: "track" (a new current track), "state" (play/pause), "time",
 * "volume", "modes" (shuffle/repeat), "error".
 */
export class Player extends EventTarget {
  constructor(audio, { random } = {}) {
    super();
    this.audio = audio;
    this.audio.preload = 'auto';
    this.queue = new Queue({ random });
    this.shuffle = false;
    this.repeat = 'off';
    this.context = null;

    const forward = (from, to) => audio.addEventListener(from, () => this.emit(to));
    forward('play', 'state');
    forward('pause', 'state');
    forward('playing', 'state');
    forward('timeupdate', 'time');
    forward('durationchange', 'time');
    forward('seeked', 'time');
    forward('volumechange', 'volume');
    audio.addEventListener('ended', () => this.handleEnded());
    audio.addEventListener('error', () => {
      if (this.current) this.emit('error', { track: this.current, reason: 'unplayable' });
    });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get current() {
    return this.queue.current;
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }

  get position() {
    return this.audio.currentTime || 0;
  }

  /**
   * The duration the server measured on upload (it counts every MP3 frame),
   * else the element's. Browsers estimate MP3 length from the file size,
   * which drifts, and is badly off for VBR files without a header.
   */
  get duration() {
    if (this.current?.duration) return this.current.duration;
    const d = this.audio.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  /**
   * Starts playing `tracks` at `index`; this list becomes the queue.
   * `context` names where the list came from (e.g. "playlist:3"), so the
   * page can tell whether the list on screen is the one playing.
   */
  playList(tracks, index = 0, { context = null } = {}) {
    this.context = context;
    this.queue.load(tracks, index, { shuffle: this.shuffle });
    this.loadCurrent({ autoplay: true });
  }

  /** Stops if `trackId` is playing (it was deleted), moving on when there is more. */
  dropTrack(trackId) {
    if (this.current?.id !== trackId) return;
    if (this.queue.next()) {
      this.loadCurrent({ autoplay: this.playing });
    } else {
      this.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.queue.load([]);
      this.emit('track', null);
      this.emit('state');
    }
  }

  loadCurrent({ autoplay }) {
    const track = this.current;
    if (!track) return;
    this.audio.src = track.streamUrl;
    this.emit('track', track);
    if (autoplay) this.play();
  }

  play() {
    if (!this.current) return Promise.resolve();
    // A rejected play() is not a broken file: AbortError means a newer src
    // replaced this one, NotAllowedError that the browser wants a click first.
    // Files that can't be decoded or fetched fire the element's "error" event.
    return Promise.resolve(this.audio.play()).catch(() => this.emit('state'));
  }

  pause() {
    this.audio.pause();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  next() {
    if (this.queue.next({ wrap: true })) this.loadCurrent({ autoplay: true });
  }

  previous() {
    if (this.position > RESTART_THRESHOLD) {
      this.seek(0);
      return;
    }
    if (this.queue.previous({ wrap: this.repeat === 'all' })) this.loadCurrent({ autoplay: true });
    else this.seek(0);
  }

  seek(seconds) {
    if (!this.current) return;
    this.audio.currentTime = clamp(seconds, 0, this.duration || 0);
    this.emit('time');
  }

  setVolume(volume) {
    this.audio.volume = clamp(volume, 0, 1);
    if (volume > 0 && this.audio.muted) this.audio.muted = false;
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
  }

  setShuffle(on) {
    this.shuffle = on;
    this.queue.setShuffle(on);
    this.emit('modes');
  }

  cycleRepeat() {
    this.repeat = REPEAT_MODES[(REPEAT_MODES.indexOf(this.repeat) + 1) % REPEAT_MODES.length];
    this.emit('modes');
  }

  setRepeat(mode) {
    if (REPEAT_MODES.includes(mode)) this.repeat = mode;
    this.emit('modes');
  }

  handleEnded() {
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.play();
    } else if (this.queue.next({ wrap: this.repeat === 'all' })) {
      this.loadCurrent({ autoplay: true });
    } else {
      this.emit('state'); // end of the queue: stay on the last song, stopped
    }
  }
}
