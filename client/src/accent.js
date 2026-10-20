// The accent color comes from the album cover: the most vivid hue on it,
// lightened until it is readable as text on Stave's dark backdrop.

export const DEFAULT_ACCENT = '#ff8a5b';

// A mid-dark stand-in for the blurred, darkened backdrop the accent sits on.
const BACKDROP = [26, 29, 38];
const MIN_CONTRAST = 4.5;
const HUE_BINS = 24;

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255));
}

function luminance([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two RGB colors. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Raises saturation and lightness until the color reads as text on the backdrop. */
export function legible(rgb) {
  let [h, s, l] = rgbToHsl(...rgb);
  s = Math.max(s, 0.55);
  l = Math.max(l, 0.55);
  while (contrast(hslToRgb(h, s, l), BACKDROP) < MIN_CONTRAST && l < 0.92) l += 0.02;
  return hslToRgb(h, s, l);
}

/**
 * Picks the accent from RGBA pixel data (as from canvas getImageData).
 * Vivid, mid-light pixels are grouped by hue, and the strongest hue wins.
 * Covers with no real color (grayscale, near black) get the default accent.
 */
export function accentFromPixels(data) {
  const bins = Array.from({ length: HUE_BINS }, () => ({ weight: 0, count: 0, r: 0, g: 0, b: 0 }));
  let sampled = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    sampled += 1;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < 0.3 || l < 0.18 || l > 0.88) continue;
    // Saturation counts twice, so a small vivid sun beats a large muted navy sky.
    const weight = s * s * (1 - Math.abs(l - 0.55));
    const bin = bins[Math.floor(h * HUE_BINS) % HUE_BINS];
    bin.weight += weight;
    bin.count += 1;
    bin.r += r * weight;
    bin.g += g * weight;
    bin.b += b * weight;
  }
  const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
  if (!sampled || best.count < sampled * 0.02) return DEFAULT_ACCENT;
  const average = [best.r, best.g, best.b].map((v) => Math.round(v / best.weight));
  return toHex(legible(average));
}

/** Loads a cover and returns its accent; any failure gives the default. */
export async function accentFromImage(url, size = 48) {
  if (!url) return DEFAULT_ACCENT;
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, size, size);
    return accentFromPixels(context.getImageData(0, 0, size, size).data);
  } catch {
    return DEFAULT_ACCENT;
  }
}
