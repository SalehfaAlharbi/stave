import cookie from '@fastify/cookie';
import { httpError } from '../errors.js';
import { SESSION_DAYS, toApiUser } from './store.js';

export const SESSION_COOKIE = 'stave_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameOrigin(origin, host) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // includes the literal "null" origin
  }
}

/**
 * Sessions and access rules for the whole app (registered on the root
 * instance, so the hooks cover every route):
 * - request.user is the signed-in user, or null
 * - everything under /api/ needs a user, unless the route sets config.public
 * - requests that change state are refused if they come from another site
 */
export async function setupAuth(app, { store }) {
  await app.register(cookie);
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    // Session cookies are SameSite=Lax already; checking Origin as well covers
    // older browsers and anything that slips through.
    if (!SAFE_METHODS.has(request.method) && request.headers.origin
      && !sameOrigin(request.headers.origin, request.headers.host)) {
      throw httpError(403, 'Cross-site request refused.');
    }

    const row = store.userForSession(request.cookies[SESSION_COOKIE]);
    request.user = row ? toApiUser(row) : null;

    if (request.url.startsWith('/api/') && !request.routeOptions.config?.public && !request.user) {
      throw httpError(401, 'Sign in to use Stave.');
    }
  });

  app.decorate('requireAdmin', async (request) => {
    if (!request.user?.isAdmin) throw httpError(403, 'Only the admin can do that.');
  });
}

export function setSessionCookie(request, reply, token) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true, // page scripts can't read it, so XSS can't steal the session
    sameSite: 'lax',
    secure: request.protocol === 'https',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Counts failed sign-ins per client address. After `max` failures within
 * the window, further attempts get 429 until the window passes.
 */
export function createLoginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map();
  const entry = (key) => {
    const found = failures.get(key);
    if (found && found.resetAt > Date.now()) return found;
    failures.delete(key);
    return null;
  };
  return {
    /** Seconds until this key may try again, or 0. */
    retryAfter(key) {
      const found = entry(key);
      return found && found.count >= max ? Math.ceil((found.resetAt - Date.now()) / 1000) : 0;
    },
    fail(key) {
      const found = entry(key) ?? { count: 0, resetAt: Date.now() + windowMs };
      found.count += 1;
      failures.set(key, found);
    },
    reset: (key) => failures.delete(key),
  };
}
