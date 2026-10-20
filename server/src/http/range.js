export const UNSATISFIABLE = Symbol('unsatisfiable');

/**
 * Parses a Range header (RFC 9110 section 14) for a file of `size` bytes.
 *
 * Returns { start, end } with an inclusive end, UNSATISFIABLE when the range
 * lies entirely past the end of the file, or null when the header should be
 * ignored and the whole file sent: no header, another unit, a malformed or
 * backwards range, or several ranges. Players only ever ask for one range,
 * so multipart/byteranges responses are not worth supporting.
 */
export function parseRange(header, size) {
  if (typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, first, last] = match;
  if (first === '' && last === '') return null;

  if (first === '') {
    // "bytes=-500": the last 500 bytes
    const length = Number(last);
    if (length === 0) return UNSATISFIABLE;
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(first);
  if (last !== '' && Number(last) < start) return null; // backwards, so invalid
  if (start >= size) return UNSATISFIABLE;
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return { start, end };
}

/** True if an If-None-Match header lists this ETag (weak comparison, as RFC 9110 requires). */
export function etagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}
