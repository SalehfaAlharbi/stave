import { parseFile, selectCover } from 'music-metadata';

export class UnsupportedAudioError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedAudioError';
    this.statusCode = 415;
  }
}

/**
 * Maps what music-metadata detected to a stored extension and MIME type.
 * Only formats that current browsers can play are accepted, because every
 * song in the library has to stream to the web client.
 */
export function classifyFormat({ container = '', codec = '' }) {
  if (container === 'MPEG' && /layer 3/i.test(codec)) return { ext: 'mp3', mime: 'audio/mpeg' };
  if (container === 'FLAC') return { ext: 'flac', mime: 'audio/flac' };
  if (container.startsWith('ADTS/')) return { ext: 'aac', mime: 'audio/aac' };
  if (container === 'Ogg' && codec === 'Opus') return { ext: 'opus', mime: 'audio/ogg' };
  if (container === 'Ogg' && codec.startsWith('Vorbis')) return { ext: 'ogg', mime: 'audio/ogg' };
  if (container === 'WAVE' && (codec === 'PCM' || codec === 'IEEE_FLOAT')) return { ext: 'wav', mime: 'audio/wav' };
  if (codec.startsWith('MPEG-4/AAC')) return { ext: 'm4a', mime: 'audio/mp4' };
  return null;
}

function unsupportedMessage({ container, codec }) {
  if (codec === 'ALAC') {
    return 'Apple Lossless (ALAC) does not play in most browsers. Convert it to FLAC or AAC first.';
  }
  const detected = [container, codec].filter(Boolean).join(' / ') || 'unknown';
  return `Unsupported audio format (${detected}). Stave accepts MP3, FLAC, M4A/AAC, Ogg Vorbis, Opus and WAV.`;
}

/** Detects an embedded image from its first bytes rather than trusting the tag's MIME field. */
function sniffImage(data) {
  const ascii = (start, end) => Buffer.from(data.subarray(start, end)).toString('latin1');
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return { ext: 'png', mime: 'image/png' };
  if (ascii(0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\0/g, '').trim().slice(0, 500);
  return text || null;
}

function positiveInt(value, max) {
  return Number.isInteger(value) && value > 0 && value <= max ? value : null;
}

/**
 * Guesses title and artist from names like "Artist - Title.mp3" or
 * "03. Title.flac", for files that have no tags.
 */
export function guessFromFilename(originalName) {
  const file = String(originalName ?? '').split(/[\\/]/).pop();
  const base = file
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d{1,3}\s*[.)-]\s+/, ''); // leading track number such as "03. " or "3 - "

  const dash = base.indexOf(' - ');
  if (dash > 0) {
    return { artist: base.slice(0, dash).trim(), title: base.slice(dash + 3).trim() || null };
  }
  return { artist: null, title: base || null };
}

/**
 * Reads format, tags and the front cover from an audio file.
 *
 * The file should have no extension: music-metadata then picks its parser by
 * sniffing the content, so a renamed text file is rejected instead of being
 * trusted because it ends in ".mp3".
 */
export async function readAudioFile(filePath) {
  let metadata;
  try {
    metadata = await parseFile(filePath, { duration: true });
  } catch (err) {
    if (err.syscall) throw err; // a disk error, not a bad upload
    throw new UnsupportedAudioError('This file is not an audio format Stave can read.');
  }

  const { format, common } = metadata;
  const type = classifyFormat(format);
  if (!type) throw new UnsupportedAudioError(unsupportedMessage(format));

  const picture = selectCover(common.picture);
  const coverType = picture ? sniffImage(picture.data) : null;

  return {
    format: {
      ...type,
      duration: Number.isFinite(format.duration) && format.duration > 0 ? format.duration : null,
    },
    tags: {
      title: cleanText(common.title),
      artist: cleanText(common.artist) ?? cleanText(common.artists?.join(', ')),
      album: cleanText(common.album),
      year: positiveInt(common.year, 9999),
      trackNo: positiveInt(common.track?.no, 9999),
    },
    cover: coverType ? { ...coverType, data: Buffer.from(picture.data) } : null,
  };
}
