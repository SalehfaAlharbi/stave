import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { accentFromPixels, contrast, DEFAULT_ACCENT, fromHex, rgbToHsl } from '../src/accent.js';
import { formatTime, formatTotal } from '../src/format.js';
import { columnDelays, HELIX, helixColumns, helixDot } from '../src/ui/helix.js';
import { WAVE_BARS, waveBars } from '../src/ui/wave.js';

/** RGBA pixel data: `share` of the pixels in `color`, the rest in `base`. */
function pixels(base, color, share, count = 1000) {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    data.set([...(i < count * share ? color : base), 255], i * 4);
  }
  return data;
}

const BACKDROP = [26, 29, 38];
const NAVY = [27, 42, 74];

describe('accentFromPixels', () => {
  test("finds the mockup cover's orange sun on navy", () => {
    const accent = accentFromPixels(pixels(NAVY, [255, 138, 91], 0.25));
    const [hue] = rgbToHsl(...fromHex(accent));
    assert.ok(Math.abs(hue * 360 - 17) < 8, `hue ${hue * 360}`);
  });

  test('lightens a dark blue until it is readable on the backdrop', () => {
    const accent = accentFromPixels(pixels([0, 0, 0], [20, 40, 160], 0.6));
    assert.ok(contrast(fromHex(accent), BACKDROP) >= 4.5, accent);
    const [hue] = rgbToHsl(...fromHex(accent));
    assert.ok(Math.abs(hue * 360 - 231) < 10, `still blue: ${hue * 360}`);
  });

  test('falls back to the default for covers without real color', () => {
    assert.equal(accentFromPixels(pixels([20, 20, 20], [230, 230, 230], 0.5)), DEFAULT_ACCENT);
    assert.equal(accentFromPixels(new Uint8ClampedArray(0)), DEFAULT_ACCENT);
  });
});

describe('formatTime / formatTotal', () => {
  test('formats song and list lengths', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(187.9), '3:07');
    assert.equal(formatTime(3765), '1:02:45');
    assert.equal(formatTime(NaN), '0:00');
    assert.equal(formatTotal(34 * 60), '34 min');
    assert.equal(formatTotal(72 * 60), '1 hr 12 min');
    assert.equal(formatTotal(120 * 60), '2 hr');
  });
});

describe('dot helix', () => {
  test("keeps the mockup's 16 columns over 167 px", () => {
    assert.equal(helixColumns(167).length, 16);
    assert.equal(helixColumns(0).length, 0);
  });

  test("a column's accent dot runs half a cycle plus one dot delay behind its white dot", () => {
    const [whiteDelay, accentDelay] = columnDelays(3);
    for (const t of [0, 0.37, 1.2]) {
      const accent = helixDot(t, accentDelay);
      const white = helixDot(t + HELIX.period / 2 + 0.1, whiteDelay);
      assert.ok(Math.abs(accent.y - white.y) < 1e-9);
    }
  });

  test('dots stay within the amplitude and loop every period', () => {
    for (let t = 0; t < 4; t += 0.05) {
      const dot = helixDot(t, -0.3);
      assert.ok(Math.abs(dot.y) <= HELIX.amplitude + 1e-9);
      assert.ok(dot.opacity >= 0.35 - 1e-9 && dot.opacity <= 1);
      assert.ok(Math.abs(helixDot(t + HELIX.period, -0.3).y - dot.y) < 1e-9);
    }
  });
});

describe('wave volume bar', () => {
  test('lights bars up to the volume, with one accent handle, and dots after it', () => {
    const bars = waveBars(0, 0.5, false);
    assert.equal(bars.length, WAVE_BARS);
    const states = bars.map((b) => b.state);
    assert.equal(states.filter((s) => s === 'edge').length, 1);
    const edge = states.indexOf('edge');
    assert.ok(states.slice(0, edge).every((s) => s === 'lit'));
    assert.ok(bars.slice(edge + 1).every((b) => b.state === 'off' && b.height === 3));
  });

  test('is tallest in the middle and silent at zero', () => {
    const heights = waveBars(0, 1, false).map((b) => b.height);
    const middle = Math.floor(WAVE_BARS / 2);
    assert.ok(heights[middle] > heights[1] && heights[middle] > heights[WAVE_BARS - 2]);
    assert.ok(waveBars(0, 0, true).every((b) => b.state === 'off'));
  });

  test('lit bars move while playing; the handle holds still', () => {
    const a = waveBars(0.0, 0.8, true);
    const b = waveBars(0.4, 0.8, true);
    assert.ok(a.some((bar, i) => bar.state === 'lit' && bar.height !== b[i].height));
    const edge = a.findIndex((bar) => bar.state === 'edge');
    assert.equal(a[edge].height, b[edge].height);
  });
});
