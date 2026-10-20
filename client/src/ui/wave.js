import { clamp } from '../format.js';

// The volume bar, drawn as a sound wave: bars on a flat baseline whose
// heights follow a sine envelope, tallest in the middle. Bars up to the
// volume are lit and move while music plays, the last lit bar is the accent
// colored handle, and the bars after it are flat dots.
export const WAVE_BARS = 23;

/** Height and look of every bar for a volume of 0..1 at time t (seconds). */
export function waveBars(t, volume, moving) {
  return Array.from({ length: WAVE_BARS }, (_, i) => {
    const u = i / (WAVE_BARS - 1);
    const envelope = Math.sin(Math.PI * u) ** 1.2;
    const r = Math.sin(i * 12.9898) * 43758.5453;
    const jitter = r - Math.floor(r); // fixed per bar, so neighbours differ
    const full = 3 + 19 * envelope * (0.82 + 0.18 * jitter);
    const lit = (i + 0.5) / WAVE_BARS <= volume;
    const edge = lit && (i + 1.5) / WAVE_BARS > volume;
    if (edge) return { height: full, state: 'edge' };
    if (!lit) return { height: 3, state: 'off' };
    if (!moving) return { height: Math.max(3, full * 0.55), state: 'lit' };
    // Three sines per bar, so it dances like a live meter without two bars moving together.
    const n = 0.5 + (Math.sin(t * 4.3 + i * 1.7) + Math.sin(t * 2.1 + i * 0.6 + 1.3) + Math.sin(t * 6.7 + i * 2.9)) / 6;
    return { height: Math.max(3, full * (0.4 + 0.6 * n)), state: 'lit' };
  });
}

/** Renders the wave into `el` (a role="slider" element); onChange(volume 0..1) on drag and keys. */
export function createWave(el, { onChange }) {
  const bars = Array.from({ length: WAVE_BARS }, () => {
    const bar = document.createElement('span');
    bar.className = 'wave-bar';
    return bar;
  });
  el.replaceChildren(...bars);

  let volume = 0;
  let moving = false;
  let lastT = 0;
  let dragging = false;

  function render(t = lastT) {
    lastT = t;
    waveBars(t, volume, moving).forEach(({ height, state }, i) => {
      bars[i].style.height = `${height.toFixed(1)}px`;
      bars[i].dataset.state = state;
    });
  }

  const volumeAt = (clientX) => {
    const box = el.getBoundingClientRect();
    return clamp((clientX - box.left) / box.width, 0, 1);
  };

  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    el.setPointerCapture(event.pointerId);
    dragging = true;
    onChange(volumeAt(event.clientX));
  });
  el.addEventListener('pointermove', (event) => {
    if (dragging) onChange(volumeAt(event.clientX));
  });
  const stop = () => { dragging = false; };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('keydown', (event) => {
    const steps = { ArrowLeft: -0.05, ArrowDown: -0.05, ArrowRight: 0.05, ArrowUp: 0.05 };
    if (event.key in steps) onChange(clamp(volume + steps[event.key], 0, 1));
    else if (event.key === 'Home') onChange(0);
    else if (event.key === 'End') onChange(1);
    else return;
    event.preventDefault();
  });

  return {
    render,
    setVolume(value) {
      volume = clamp(value, 0, 1);
      el.setAttribute('aria-valuenow', String(Math.round(volume * 100)));
      el.setAttribute('aria-valuetext', `${Math.round(volume * 100)}%`);
      render();
    },
    setMoving(on) {
      moving = on;
      render();
    },
  };
}
