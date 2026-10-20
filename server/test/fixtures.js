// Small audio files built in code, so the tests need no binary fixtures or
// ffmpeg. Each builder writes real tags (ID3v2.4, RIFF INFO, Vorbis comments)
// that music-metadata parses exactly like it would a ripped song.

/** A valid 1x1 PNG, used as embedded cover art. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

// ---- MP3 ------------------------------------------------------------------

function syncsafe(n) {
  return Buffer.from([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]);
}

function id3Frame(id, body) {
  return Buffer.concat([Buffer.from(id, 'latin1'), syncsafe(body.length), Buffer.from([0, 0]), body]);
}

function id3Text(id, text) {
  return id3Frame(id, Buffer.concat([Buffer.from([0x03]), Buffer.from(text, 'utf8')])); // 0x03 = UTF-8
}

function id3v24({ title, artist, album, year, track, cover }) {
  const frames = [];
  if (title) frames.push(id3Text('TIT2', title));
  if (artist) frames.push(id3Text('TPE1', artist));
  if (album) frames.push(id3Text('TALB', album));
  if (year) frames.push(id3Text('TDRC', String(year)));
  if (track) frames.push(id3Text('TRCK', String(track)));
  if (cover) {
    // encoding, MIME, picture type 3 (front cover), empty description, data
    frames.push(id3Frame('APIC', Buffer.concat([
      Buffer.from([0x00]), Buffer.from('image/png\0', 'latin1'), Buffer.from([0x03, 0x00]), cover,
    ])));
  }
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), syncsafe(body.length), body]);
}

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono. All-zero side info and main
// data decode as silence. Each frame is 417 bytes and lasts 1152 samples.
const MP3_FRAME = Buffer.alloc(417);
MP3_FRAME.set([0xff, 0xfb, 0x90, 0xc0]);
export const MP3_FRAME_SECONDS = 1152 / 44100;

export function makeMp3({ seconds = 5, tags } = {}) {
  const frameCount = Math.round(seconds / MP3_FRAME_SECONDS);
  const audio = Buffer.concat(Array.from({ length: frameCount }, () => MP3_FRAME));
  return tags ? Buffer.concat([id3v24(tags), audio]) : audio;
}

// ---- WAV ------------------------------------------------------------------

function riffChunk(id, data) {
  const pad = Buffer.alloc(data.length % 2);
  return Buffer.concat([Buffer.from(id, 'latin1'), u32le(data.length), data, pad]);
}

/** 16-bit mono PCM silence, with an optional RIFF INFO tag list. */
export function makeWav({ seconds = 1, sampleRate = 8000, tags = {} } = {}) {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // channels
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * 2, 8); // byte rate
  fmt.writeUInt16LE(2, 12); // block align
  fmt.writeUInt16LE(16, 14); // bits per sample

  const chunks = [riffChunk('fmt ', fmt), riffChunk('data', Buffer.alloc(Math.round(seconds * sampleRate) * 2))];
  const info = Object.entries({ INAM: tags.title, IART: tags.artist, IPRD: tags.album }).filter(([, v]) => v);
  if (info.length) {
    chunks.push(riffChunk('LIST', Buffer.concat([
      Buffer.from('INFO'),
      ...info.map(([id, value]) => riffChunk(id, Buffer.from(`${value}\0`, 'utf8'))),
    ])));
  }
  const body = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(body.length), body]);
}

// ---- FLAC -----------------------------------------------------------------

function flacBlock(type, data, isLast) {
  const header = Buffer.alloc(4);
  header[0] = (isLast ? 0x80 : 0) | type;
  header.writeUIntBE(data.length, 1, 3);
  return Buffer.concat([header, data]);
}

/**
 * FLAC metadata blocks only (STREAMINFO, Vorbis comments, picture). There are
 * no audio frames, which is enough for tag reading but not for playback.
 */
export function makeFlac({ seconds = 3, sampleRate = 44100, tags = {}, cover } = {}) {
  const streamInfo = Buffer.alloc(34);
  streamInfo.writeUInt16BE(4096, 0); // min block size
  streamInfo.writeUInt16BE(4096, 2); // max block size
  const packed = (BigInt(sampleRate) << 44n) | (1n << 41n) /* 2 channels */ | (15n << 36n) /* 16 bit */
    | BigInt(Math.round(seconds * sampleRate));
  streamInfo.writeBigUInt64BE(packed, 10);

  const comments = Object.entries({ TITLE: tags.title, ARTIST: tags.artist, ALBUM: tags.album, DATE: tags.year })
    .filter(([, v]) => v)
    .map(([key, value]) => Buffer.from(`${key}=${value}`, 'utf8'));
  const vendor = Buffer.from('stave-tests');
  const vorbis = Buffer.concat([
    u32le(vendor.length), vendor, u32le(comments.length),
    ...comments.flatMap((c) => [u32le(c.length), c]),
  ]);

  const blocks = [[0, streamInfo], [4, vorbis]];
  if (cover) {
    const mime = Buffer.from('image/png');
    blocks.push([6, Buffer.concat([
      u32be(3), u32be(mime.length), mime, u32be(0), u32be(1), u32be(1), u32be(32), u32be(0), u32be(cover.length), cover,
    ])]);
  }
  return Buffer.concat([
    Buffer.from('fLaC'),
    ...blocks.map(([type, data], i) => flacBlock(type, data, i === blocks.length - 1)),
  ]);
}
