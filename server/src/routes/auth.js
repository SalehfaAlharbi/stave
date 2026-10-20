import { timingSafeEqual } from 'node:crypto';
import { clearSessionCookie, setSessionCookie } from '../auth/plugin.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/passwords.js';
import { toApiUser } from '../auth/store.js';
import { httpError } from '../errors.js';

const SQLITE_CONSTRAINT_UNIQUE = 2067;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

const name = { type: 'string', minLength: 1, maxLength: 40 };
const newPassword = { type: 'string', minLength: 8, maxLength: 200 };
const body = (properties) => ({
  type: 'object',
  required: Object.keys(properties),
  additionalProperties: false,
  properties,
});

function cleanName(raw) {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!NAME_PATTERN.test(trimmed)) {
    throw httpError(400, 'Names can use letters, numbers, spaces, dots, dashes and underscores.');
  }
  return trimmed;
}

/** Compares setup codes ignoring case, spaces and dashes, in constant time. */
function codesMatch(given, expected) {
  const norm = (code) => Buffer.from(String(code).toUpperCase().replace(/[\s-]/g, ''));
  const a = norm(given);
  const b = norm(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function authRoutes(app, { store, limiter, setup }) {
  const isPublic = { public: true };

  function startSession(request, reply, user) {
    setSessionCookie(request, reply, store.createSession(user.id));
    return { user: toApiUser(user) };
  }

  function checkLimit(request, reply) {
    const wait = limiter.retryAfter(request.ip);
    if (wait) {
      reply.header('retry-after', String(wait));
      throw httpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.`);
    }
  }

  app.get('/api/auth/status', { config: isPublic }, async (request) => ({
    user: request.user,
    setupRequired: store.userCount() === 0,
  }));

  // First run: whoever has the setup code from the server log creates the admin account.
  app.post('/api/auth/setup', {
    config: isPublic,
    schema: { body: body({ name, password: newPassword, code: { type: 'string', maxLength: 40 } }) },
  }, async (request, reply) => {
    if (store.userCount() > 0) throw httpError(409, 'Stave is already set up. Sign in instead.');
    checkLimit(request, reply);
    if (!setup.code || !codesMatch(request.body.code, setup.code)) {
      limiter.fail(request.ip);
      throw httpError(403, "That setup code isn't right. It's printed in the server log.");
    }
    const user = store.createFirstUser(cleanName(request.body.name), await hashPassword(request.body.password));
    if (!user) throw httpError(409, 'Stave is already set up. Sign in instead.');
    setup.code = null;
    request.log.info({ user: user.name }, 'admin account created');
    return reply.code(201).send(startSession(request, reply, user));
  });

  app.post('/api/auth/login', {
    config: isPublic,
    schema: { body: body({ name, password: { type: 'string', minLength: 1, maxLength: 200 } }) },
  }, async (request, reply) => {
    checkLimit(request, reply);
    const user = store.findUserByName(request.body.name.trim());
    // Hash even when the name is unknown, so the timing doesn't reveal which names exist.
    const ok = await verifyPassword(request.body.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      limiter.fail(request.ip);
      throw httpError(401, 'Wrong name or password.');
    }
    limiter.reset(request.ip);
    return startSession(request, reply, user);
  });

  app.post('/api/auth/logout', { config: isPublic }, async (request, reply) => {
    store.deleteSession(request.cookies.stave_session);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  // Invites: single-use links that let someone create an account.
  app.post('/api/invites', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { code, expiresAt } = store.createInvite(request.user.id);
    return reply.code(201).send({ code, url: `/?invite=${code}`, expiresAt });
  });

  app.get('/api/invites/:code', { config: isPublic }, async (request) => {
    const invite = store.findOpenInvite(request.params.code);
    if (!invite) throw httpError(404, 'This invite link has expired or was already used.');
    return { invitedBy: invite.inviter, expiresAt: invite.expires_at };
  });

  app.post('/api/auth/register', {
    config: isPublic,
    schema: { body: body({ code: { type: 'string', minLength: 1, maxLength: 100 }, name, password: newPassword }) },
  }, async (request, reply) => {
    const userName = cleanName(request.body.name);
    const passwordHash = await hashPassword(request.body.password);
    let user;
    try {
      user = store.createInvitedUser(request.body.code, userName, passwordHash);
    } catch (err) {
      if (err.errcode === SQLITE_CONSTRAINT_UNIQUE) throw httpError(409, 'That name is taken. Pick another one.');
      throw err;
    }
    if (!user) throw httpError(404, 'This invite link has expired or was already used.');
    request.log.info({ user: user.name }, 'account created from invite');
    return reply.code(201).send(startSession(request, reply, user));
  });
}
