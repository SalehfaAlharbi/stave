// Pure helpers for synced lyrics, kept apart from the DOM so they can be unit-tested.

/** Highlight a line this many seconds early; it feels in time rather than late. */
export const LEAD_SECONDS = 0.25;

/** Index of the line being sung at `position` (seconds), or -1 before the first. Lines are sorted. */
export function currentLineIndex(lines, position) {
  const t = position + LEAD_SECONDS;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** [mm:ss.xx], the LRC timestamp for `seconds`. */
export function lrcStamp(seconds) {
  const centis = Math.max(0, Math.round(seconds * 100));
  const mm = String(Math.floor(centis / 6000)).padStart(2, '0');
  const ss = String(Math.floor((centis % 6000) / 100)).padStart(2, '0');
  const cc = String(centis % 100).padStart(2, '0');
  return `[${mm}:${ss}.${cc}]`;
}

/**
 * "Stamp line": puts the current time at the start of the line the caret is
 * on (replacing any stamps already there) and returns the new text plus where
 * the caret goes next, which is the start of the following line.
 */
export function stampLine(text, caret, seconds) {
  const start = text.lastIndexOf('\n', caret - 1) + 1;
  const endAt = text.indexOf('\n', caret);
  const end = endAt === -1 ? text.length : endAt;
  const words = text.slice(start, end).replace(/^(\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+\s*/, '');
  const line = `${lrcStamp(seconds)} ${words}`.trimEnd();
  const next = text.slice(0, start) + line + text.slice(end);
  const nextLine = start + line.length + 1;
  return { text: next, caret: Math.min(nextLine, next.length) };
}
