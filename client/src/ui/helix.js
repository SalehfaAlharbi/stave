import { clamp } from '../format.js';

// The dot-helix progress bar. The played part is pairs of dots (white and
// accent) orbiting each other half a cycle apart, like a loader; the part
// still to play is a row of flat, faint dots. The motion is the mockup's:
// 2 s cycle, 0.1 s delay per dot, flipped so the delay grows toward the
// playhead, with dots 10.7 px apart (its 16 columns over 167 px).
export const HELIX = { spacing: 161 / 15, inset: 3, amplitude: 8.5, period: 2 };

const ease = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, u) => a + (b - a) * u;

/** Offset, depth, scale and opacity of one dot at time t (seconds). */
export function helixDot(t, delay) {
  const { amplitude: D, period: T } = HELIX;
  let p = ((t - delay) / T) % 1;
  if (p < 0) p += 1;
  const y = p < 0.5 ? lerp(-D, D, ease(p * 2)) : lerp(D, -D, ease((p - 0.5) * 2));
  const z = Math.round(p < 0.5 ? lerp(0, 10, p * 2) : lerp(10, -5, (p - 0.5) * 2));
  let scale;
  if (p < 0.25) scale = lerp(1, 1.5, ease(p / 0.25));
  else if (p < 0.75) scale = lerp(1.5, 0.5, ease((p - 0.25) / 0.5));
  else scale = lerp(0.5, 1, ease((p - 0.75) / 0.25));
  let opacity;
  if (p < 0.5) opacity = 1;
  else if (p < 0.75) opacity = lerp(1, 0.35, ease((p - 0.5) / 0.25));
  else opacity = lerp(0.35, 1, ease((p - 0.75) / 0.25));
  return { y, z, scale, opacity };
}

/** The x position of every column in a bar `width` px wide. */
export function helixColumns(width) {
  const { spacing, inset } = HELIX;
  const count = width > 2 * inset ? Math.floor((width - 2 * inset) / spacing) + 1 : 0;
  return Array.from({ length: count }, (_, j) => inset + j * spacing);
}

/** Start delays of column j's white and accent dots. */
export function columnDelays(j) {
  const move = j + 1;
  return [-((2 * move - 1) * 0.1), -(2 * move * 0.1 + HELIX.period / 2)];
}

/**
 * Renders the helix into `el` (a role="slider" element) and turns pointer and
 * keyboard input into seeks. onScrub(fraction) fires while dragging,
 * onSeek(fraction) on release, onStep(seconds) for arrow keys.
 */
export function createHelix(el, { onScrub, onSeek, onStep }) {
  let columns = [];
  let nodes = [];
  let width = 0;
  let progress = 0;
  let scrub = null;
  let enabled = false;
  let lastT = 0;

  function build() {
    width = el.clientWidth;
    columns = helixColumns(width);
    nodes = columns.map((x) => {
      const rest = document.createElement('span');
      rest.className = 'helix-dot is-rest';
      rest.style.transform = `translate(${x}px, 0)`;
      const white = document.createElement('span');
      white.className = 'helix-dot';
      const accent = document.createElement('span');
      accent.className = 'helix-dot is-accent';
      return { rest, pair: [white, accent] };
    });
    el.replaceChildren(...nodes.flatMap(({ rest, pair }) => [rest, ...pair]));
    render(lastT);
  }

  function render(t) {
    lastT = t;
    const fraction = scrub ?? progress;
    const played = fraction * width;
    columns.forEach((x, j) => {
      const { rest, pair } = nodes[j];
      const on = fraction > 0 && x <= played;
      rest.hidden = on;
      pair[0].hidden = pair[1].hidden = !on;
      if (!on) return;
      columnDelays(j).forEach((delay, k) => {
        const dot = helixDot(t, delay);
        const node = pair[k];
        node.style.transform = `translate(${x}px, ${dot.y.toFixed(2)}px) scale(${dot.scale.toFixed(3)})`;
        node.style.opacity = dot.opacity.toFixed(2);
        node.style.zIndex = String(dot.z);
      });
    });
  }

  const fractionAt = (clientX) => clamp((clientX - el.getBoundingClientRect().left) / width, 0, 1);

  el.addEventListener('pointerdown', (event) => {
    if (!enabled || event.button !== 0) return;
    el.setPointerCapture(event.pointerId);
    scrub = fractionAt(event.clientX);
    onScrub(scrub);
    render(lastT);
  });
  el.addEventListener('pointermove', (event) => {
    if (scrub === null) return;
    scrub = fractionAt(event.clientX);
    onScrub(scrub);
    render(lastT);
  });
  el.addEventListener('pointerup', () => {
    if (scrub === null) return;
    const fraction = scrub;
    scrub = null;
    onSeek(fraction);
  });
  el.addEventListener('pointercancel', () => {
    scrub = null;
    render(lastT);
  });
  el.addEventListener('keydown', (event) => {
    if (!enabled) return;
    const steps = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 };
    if (event.key in steps) onStep(steps[event.key]);
    else if (event.key === 'Home') onSeek(0);
    else if (event.key === 'End') onSeek(0.999);
    else return;
    event.preventDefault();
  });

  new ResizeObserver(build).observe(el);

  return {
    render,
    get scrubbing() {
      return scrub !== null;
    },
    /** Moves the playhead without touching ARIA; called every animation frame. */
    setFraction(fraction) {
      progress = clamp(fraction || 0, 0, 1);
    },
    /** fraction 0..1; label like "1:42 of 3:36" for screen readers */
    setProgress(fraction, { now, max, label }) {
      progress = clamp(fraction || 0, 0, 1);
      el.setAttribute('aria-valuemax', String(Math.round(max)));
      el.setAttribute('aria-valuenow', String(Math.round(now)));
      el.setAttribute('aria-valuetext', label);
      if (scrub === null) render(lastT);
    },
    setEnabled(on) {
      enabled = on;
      el.setAttribute('aria-disabled', String(!on));
    },
  };
}
