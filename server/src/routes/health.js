import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

// Public, for uptime checks and Docker's healthcheck. The library size is
// only shown to signed-in users.
export default async function healthRoutes(app) {
  app.get('/api/health', { config: { public: true } }, async (request) => ({
    status: 'ok',
    version,
    ...(request.user ? { tracks: app.library.count() } : {}),
  }));
}
