import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_SERVER = 'http://192.168.0.124:4545';

/**
 * settings.json in the app's userData folder. Written to a temp file and
 * renamed, so a crash mid-write can't leave a half-written file behind.
 */
export function createSettings(file) {
  let data = {};
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // first launch, or an unreadable file: start fresh
  }

  return {
    get: (key) => data[key],
    set(key, value) {
      data = { ...data, [key]: value };
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
      renameSync(`${file}.tmp`, file);
    },
  };
}

/**
 * Turns what someone typed ("192.168.0.124:4545", "http://music.local/") into
 * an origin like "http://192.168.0.124:4545". Throws a readable error otherwise.
 */
export function normalizeServerUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) throw new Error('Enter the address of your Stave server.');
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    throw new Error(`"${text}" isn't a web address.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Use an http:// or https:// address.');
  return url.origin;
}
