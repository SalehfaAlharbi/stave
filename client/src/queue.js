/**
 * The play order for a list of tracks. Pure state, no audio or DOM, so the
 * shuffle and wrap rules are unit-tested on their own.
 *
 * `order` holds indexes into `tracks`; `pos` is where we are in `order`.
 */
export class Queue {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.tracks = [];
    this.order = [];
    this.pos = -1;
  }

  get length() {
    return this.order.length;
  }

  get current() {
    return this.pos >= 0 ? this.tracks[this.order[this.pos]] : null;
  }

  /** Plays `tracks` starting at `startIndex`. With shuffle, that track still plays first. */
  load(tracks, startIndex = 0, { shuffle = false } = {}) {
    this.tracks = tracks.slice();
    this.order = this.tracks.map((_, i) => i);
    this.pos = this.tracks.length ? Math.min(Math.max(0, startIndex), this.tracks.length - 1) : -1;
    if (shuffle) this.setShuffle(true);
  }

  /** Turning shuffle on keeps the current track and shuffles everything else after it. */
  setShuffle(on) {
    const playing = this.pos >= 0 ? this.order[this.pos] : undefined;
    const natural = this.tracks.map((_, i) => i);
    if (!on) {
      this.order = natural;
      this.pos = playing ?? -1;
      return;
    }
    const rest = natural.filter((i) => i !== playing);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.order = playing === undefined ? rest : [playing, ...rest];
    this.pos = playing === undefined ? -1 : 0;
  }

  /** Moves to the next track; at the end, wraps to the start only if `wrap`. Returns it or null. */
  next({ wrap = false } = {}) {
    if (!this.length) return null;
    if (this.pos + 1 < this.length) this.pos += 1;
    else if (wrap) this.pos = 0;
    else return null;
    return this.current;
  }

  previous({ wrap = false } = {}) {
    if (!this.length) return null;
    if (this.pos > 0) this.pos -= 1;
    else if (wrap) this.pos = this.length - 1;
    else return null;
    return this.current;
  }
}
