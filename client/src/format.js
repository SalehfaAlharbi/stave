const pad = (n) => String(n).padStart(2, '0');

/** 0:00, 3:07, 1:02:45 */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** "34 min", "1 hr 12 min" for a whole list. */
export function formatTotal(seconds) {
  const minutes = Math.round((Number.isFinite(seconds) ? seconds : 0) / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} hr${rest ? ` ${rest} min` : ''}`;
}

export function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
