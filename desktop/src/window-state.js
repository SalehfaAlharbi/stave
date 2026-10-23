// Remembering where the window was. Pure functions, so the "monitor was
// unplugged" cases are unit-tested without Electron.

export const DEFAULT_SIZE = { width: 1280, height: 800 };
export const MIN_SIZE = { width: 360, height: 560 };

// How much of the window's top strip (where you grab it) must be on a
// screen for the saved position to count as reachable.
const GRAB_WIDTH = 120;
const GRAB_HEIGHT = 40;

function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? { width, height } : null;
}

const isNumber = (n) => Number.isFinite(n);

/**
 * Where to open the window: the saved bounds if the title strip is on one of
 * `workAreas` (each { x, y, width, height }), else the saved size (or the
 * default), fitted to and centred on `primary`.
 */
export function restoreBounds(saved, workAreas, primary) {
  const valid = saved && [saved.x, saved.y, saved.width, saved.height].every(isNumber);
  const size = valid ? saved : DEFAULT_SIZE;
  // No larger than the screen it opens on, no smaller than the app allows.
  const fit = (area) => ({
    width: Math.round(Math.max(MIN_SIZE.width, Math.min(size.width, area.width))),
    height: Math.round(Math.max(MIN_SIZE.height, Math.min(size.height, area.height))),
  });

  if (valid) {
    const strip = { x: saved.x, y: saved.y, width: Math.max(MIN_SIZE.width, saved.width), height: GRAB_HEIGHT };
    const home = workAreas.find((area) => {
      const o = overlap(strip, area);
      return o && o.width >= Math.min(GRAB_WIDTH, strip.width) && o.height >= Math.min(GRAB_HEIGHT, area.height);
    });
    if (home) return { x: Math.round(saved.x), y: Math.round(saved.y), ...fit(home) };
  }
  const { width, height } = fit(primary);
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height,
  };
}

/** What gets saved: the normal (not maximized) bounds plus whether it was maximized. */
export function stateToSave(normalBounds, maximized) {
  const { x, y, width, height } = normalBounds;
  return { x, y, width, height, maximized: Boolean(maximized) };
}
