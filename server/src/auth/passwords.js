import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// scrypt is built into Node and memory-hard, so guessing passwords from a
// stolen database is slow on GPUs. N=2^15 takes about 50 ms here.
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 32;
const maxmem = (N, r) => 256 * N * r; // scrypt needs 128*N*r bytes; leave headroom

/** Returns "scrypt$N$r$p$salt$hash", with the parameters stored so they can change later. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const { N, r, p } = PARAMS;
  const hash = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p, maxmem: maxmem(N, r) });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: maxmem(Number(N), Number(r)),
  });
  return timingSafeEqual(actual, expected);
}

// A real hash of a random password, so a login for a name that does not
// exist takes as long as one with a wrong password.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));
