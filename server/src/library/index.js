import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { httpError } from '../errors.js';
import { guessFromFilename, readAudioFile } from './metadata.js';
import { createTrackStore } from './tracks.js';

const COVER_NAME = /^[a-f0-9]{64}\.(jpg|png|gif|webp)$/;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * The music library: stores uploaded files on disk and their metadata in
 * SQLite.
 *
 * Layout inside the data dir:
 *   music/<sha256>.<ext>   audio, named by content hash (no name clashes, easy dedupe)
 *   covers/<sha256>.<ext>  cover art, shared by every track with the same image
 *   tmp/                   uploads in progress
 */
export function createLibrary({ db, dataDir, maxUploadBytes }) {
  const dirs = {
    music: join(dataDir, 'music'),
    covers: join(dataDir, 'covers'),
    tmp: join(dataDir, 'tmp'),
  };
  const tracks = createTrackStore(db);
  const absolute = (relativePath) => join(dataDir, relativePath);

  async function init() {
    await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));
    // Uploads that were interrupted by a crash or restart.
    for (const name of await readdir(dirs.tmp)) {
      await rm(join(dirs.tmp, name), { force: true });
    }
  }

  /** Streams an upload to a temp file, hashing it and enforcing the size limit on the way. */
  async function receive(stream) {
    // No extension on purpose: see readAudioFile.
    const tmpPath = join(dirs.tmp, randomUUID());
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > maxUploadBytes) return callback(tooLarge());
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(stream, meter, createWriteStream(tmpPath));
      // Multipart parsers stop at their own limit and mark the stream as truncated.
      if (stream.truncated) throw tooLarge();
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err.code === 'FST_REQ_FILE_TOO_LARGE' ? tooLarge() : err;
    }
    return { tmpPath, hash: hash.digest('hex'), size };
  }

  function tooLarge() {
    return httpError(413, `The file is larger than the ${Math.round(maxUploadBytes / 1024 / 1024)} MB upload limit.`);
  }

  async function saveCover({ data, ext }) {
    const relativePath = `covers/${sha256(data)}.${ext}`;
    try {
      await access(absolute(relativePath));
    } catch {
      const tmpPath = join(dirs.tmp, randomUUID());
      await writeFile(tmpPath, data);
      await rename(tmpPath, absolute(relativePath));
    }
    return relativePath;
  }

  async function removeCoverIfUnused(coverPath) {
    if (coverPath && tracks.coverUseCount(coverPath) === 0) {
      await rm(absolute(coverPath), { force: true });
    }
  }

  /**
   * Adds an uploaded song. Returns { track, duplicate }; when the exact same
   * file is already in the library, nothing is stored and the existing track
   * is returned.
   */
  async function ingest(stream, originalName, { uploadedBy = null } = {}) {
    const { tmpPath, hash, size } = await receive(stream);
    try {
      const existing = tracks.findByHash(hash);
      if (existing) return { track: existing, duplicate: true };

      const { format, tags, cover } = await readAudioFile(tmpPath);
      const guess = guessFromFilename(originalName);
      const filePath = `music/${hash}.${format.ext}`;
      const coverPath = cover ? await saveCover(cover) : null;
      await rename(tmpPath, absolute(filePath));

      try {
        const track = tracks.insert({
          title: tags.title ?? guess.title ?? 'Untitled',
          artist: tags.artist ?? guess.artist,
          album: tags.album,
          year: tags.year,
          track_no: tags.trackNo,
          duration: format.duration,
          source: 'upload',
          file_path: filePath,
          file_hash: hash,
          file_size: size,
          mime_type: format.mime,
          original_name: originalName,
          cover_path: coverPath,
          uploaded_by: uploadedBy,
        });
        return { track, duplicate: false };
      } catch (err) {
        // The same file finished uploading twice at once. The winner's row
        // points at the same content-addressed path, so keep the file.
        if (err.errcode === SQLITE_CONSTRAINT_UNIQUE && err.message.includes('tracks.file_hash')) {
          return { track: tracks.findByHash(hash), duplicate: true };
        }
        await rm(absolute(filePath), { force: true });
        await removeCoverIfUnused(coverPath);
        throw err;
      }
    } finally {
      await rm(tmpPath, { force: true }); // no-op once the file has been moved
    }
  }

  /** Deletes a track's row, its audio file, and its cover if no other track uses it. */
  async function remove(id) {
    const track = tracks.findById(id);
    if (!track) return null;
    tracks.delete(id);
    await rm(absolute(track.file_path), { force: true });
    await removeCoverIfUnused(track.cover_path);
    return track;
  }

  /** Absolute path of a cover file, or null if the name is not a valid cover name. */
  function coverFile(name) {
    return COVER_NAME.test(name) ? join(dirs.covers, name) : null;
  }

  return {
    init,
    ingest,
    remove,
    coverFile,
    audioFile: (track) => absolute(track.file_path),
    get: tracks.findById,
    list: tracks.list,
    count: tracks.count,
  };
}
