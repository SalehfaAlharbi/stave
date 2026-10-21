// LRC: one lyric line per text line, each starting with one or more
// [mm:ss.xx] timestamps. Also handled: [mm:ss] and [mm:ss.xxx] stamps,
// [offset:+/-ms], metadata tags like [ar:...] (ignored), and word-level
// <mm:ss.xx> stamps from "enhanced" LRC (stripped).

const LEADING_STAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]$/i;
const META_TAG = /^\[[a-z]+:[^\]]*\]$/i;

/** True if the text has at least one line that starts with an LRC timestamp. */
export function isLrc(text) {
  return /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(String(text ?? ''));
}

const seconds = (min, sec, frac = '') => Number(min) * 60 + Number(sec) + (frac ? Number(`0.${frac}`) : 0);

/** Parses LRC into [{ time, text }] sorted by time. An empty text marks an instrumental gap. */
export function parseLrc(text) {
  let offset = 0;
  const lines = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const offsetTag = OFFSET_TAG.exec(line);
    if (offsetTag) {
      // Positive offsets make lyrics appear sooner.
      offset = Number(offsetTag[1]) / 1000;
      continue;
    }
    if (!line || (META_TAG.test(line) && !LEADING_STAMP.test(line))) continue;

    const times = [];
    let rest = line;
    let stamp;
    while ((stamp = LEADING_STAMP.exec(rest))) {
      times.push(seconds(stamp[1], stamp[2], stamp[3]));
      rest = rest.slice(stamp[0].length);
    }
    if (!times.length) continue; // stray unstamped line in an LRC file
    const lyric = rest.replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();
    for (const time of times) lines.push({ time: Math.max(0, Math.round((time - offset) * 1000) / 1000), text: lyric });
  }
  return lines.sort((a, b) => a.time - b.time); // stable, so equal stamps keep file order
}

/** Plain lyrics as lines, keeping single blank lines between verses. */
export function parsePlain(text) {
  const lines = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line && (!lines.length || lines.at(-1).text === '')) continue;
    lines.push({ time: null, text: line });
  }
  while (lines.length && lines.at(-1).text === '') lines.pop();
  return lines;
}

/** LRC with the timestamps removed, for the plain copy of hand-made synced lyrics. */
export function lrcToPlain(text) {
  return parseLrc(text).map((line) => line.text).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
