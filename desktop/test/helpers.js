import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { startServer } from '../../server/test/helpers.js';

export { ADMIN } from '../../server/test/helpers.js';

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url));
const CLIENT_DIR = fileURLToPath(new URL('../../client', import.meta.url));
const SHOTS_DIR = process.env.STAVE_SHOTS_DIR;

/**
 * Everything one test needs, cleaned up in the right order when it ends:
 * apps are closed first, then their profile folders deleted (Windows can't
 * delete files a running app still has open), then the server stops.
 */
export async function setUp(t) {
  const apps = [];
  const profiles = [];
  let server = null;

  t.after(async () => {
    for (const app of apps.reverse()) await app.close().catch(() => {});
    for (const dir of profiles) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  return {
    /** A Stave server with the real client, on a random port. */
    async server(options = {}) {
      server = await startServer(t, { clientDir: CLIENT_DIR, ...options });
      return server;
    },

    /** A fresh profile folder; `settings` pre-fills settings.json. */
    async profile(settings) {
      const dir = await mkdtemp(join(tmpdir(), 'stave-desktop-'));
      if (settings) await writeFile(join(dir, 'settings.json'), JSON.stringify(settings));
      profiles.push(dir);
      return dir;
    },

    /** Launches the real desktop app on `userData`; Playwright drives it over the DevTools protocol. */
    async launch(userData, env = {}) {
      const app = await electron.launch({
        args: ['.'],
        cwd: DESKTOP_DIR,
        // Hidden: tests never put a window on screen for someone to type into.
        env: { ...process.env, STAVE_DESKTOP_USER_DATA: userData, STAVE_DESKTOP_HIDDEN: '1', ...env },
      });
      apps.push(app);
      const window = await app.firstWindow();
      return { app, window, close: () => app.close() };
    },
  };
}

/** Saves a screenshot when STAVE_SHOTS_DIR is set, to show a step working. */
export async function shot(window, name) {
  if (SHOTS_DIR) await window.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

/** The BrowserWindow's size, position and state, from the main process. */
export const windowState = (app) => app.evaluate(({ BrowserWindow }) => {
  const [win] = BrowserWindow.getAllWindows();
  return { ...win.getBounds(), maximized: win.isMaximized(), title: win.getTitle() };
});

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
