import { createHash, randomBytes } from 'node:crypto';
import { transaction } from '../db/index.js';

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_DAYS = 30;
const INVITE_DAYS = 7;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const isoIn = (ms) => new Date(Date.now() + ms).toISOString();

export function toApiUser(row) {
  return { id: row.id, name: row.name, isAdmin: row.is_admin === 1 };
}

/** Users, sessions and invites. Tokens and invite codes are only ever stored hashed. */
export function createAuthStore(db) {
  const q = {
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByName: db.prepare('SELECT * FROM users WHERE name = ?'),
    insertUser: db.prepare('INSERT INTO users (name, password_hash, is_admin) VALUES (?, ?, ?) RETURNING *'),

    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare(`
      SELECT u.*, s.expires_at AS session_expires_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `),
    extendSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

    insertInvite: db.prepare('INSERT INTO invites (code_hash, created_by, expires_at) VALUES (?, ?, ?)'),
    openInvite: db.prepare(`
      SELECT i.*, u.name AS inviter FROM invites i JOIN users u ON u.id = i.created_by
      WHERE i.code_hash = ? AND i.used_by IS NULL AND i.expires_at > ?
    `),
    useInvite: db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code_hash = ? AND used_by IS NULL'),
  };
  const now = () => new Date().toISOString();

  return {
    userCount: () => q.countUsers.get().n,
    findUserByName: (name) => q.userByName.get(name),
    findUserById: (id) => q.userById.get(id),

    /** The first account is the admin; refuses if any account exists (checked in the same transaction). */
    createFirstUser(name, passwordHash) {
      return transaction(db, () => {
        if (q.countUsers.get().n > 0) return null;
        return q.insertUser.get(name, passwordHash, 1);
      });
    },

    /** Creates an account and uses up the invite, or returns null if the invite is no longer open. */
    createInvitedUser(code, name, passwordHash) {
      return transaction(db, () => {
        const codeHash = sha256(code);
        if (!q.openInvite.get(codeHash, now())) return null;
        const user = q.insertUser.get(name, passwordHash, 0);
        q.useInvite.run(user.id, now(), codeHash);
        return user;
      });
    },

    createSession(userId) {
      const token = newToken();
      q.insertSession.run(sha256(token), userId, isoIn(SESSION_DAYS * DAY));
      return token;
    },

    /**
     * The user for a session token, or null. Sessions slide: one more than
     * halfway to expiring is renewed, so active users stay signed in.
     */
    userForSession(token) {
      if (!token) return null;
      const tokenHash = sha256(token);
      const row = q.sessionUser.get(tokenHash, now());
      if (!row) return null;
      if (Date.parse(row.session_expires_at) - Date.now() < (SESSION_DAYS / 2) * DAY) {
        q.extendSession.run(isoIn(SESSION_DAYS * DAY), tokenHash);
      }
      return row;
    },

    deleteSession: (token) => token && q.deleteSession.run(sha256(token)),
    pruneSessions: () => q.deleteExpiredSessions.run(now()).changes,

    createInvite(userId) {
      const code = newToken();
      const expiresAt = isoIn(INVITE_DAYS * DAY);
      q.insertInvite.run(sha256(code), userId, expiresAt);
      return { code, expiresAt };
    },

    findOpenInvite: (code) => (code ? q.openInvite.get(sha256(code), now()) : null),
  };
}
