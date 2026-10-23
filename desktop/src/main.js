import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, screen, session, shell, Tray } from 'electron';
import { createSettings, DEFAULT_SERVER, normalizeServerUrl } from './settings.js';
import { MIN_SIZE, restoreBounds, stateToSave } from './window-state.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..');
const PRELOAD = join(HERE, 'preload.cjs');
const PAGES = join(HERE, 'pages');
const PAGES_URL = pathToFileURL(PAGES).href;
const isDev = !app.isPackaged;

// Tests point the app at a throwaway profile; normal runs use %APPDATA%\Stave.
if (process.env.STAVE_DESKTOP_USER_DATA) app.setPath('userData', process.env.STAVE_DESKTOP_USER_DATA);
// Tests also run it hidden: no window on screen, no tray icon, nothing to click by mistake.
const hidden = process.env.STAVE_DESKTOP_HIDDEN === '1';

// Links meant for the normal browser. In test mode they are only recorded
// (tests read globalThis.staveTest.openedExternally), so a test run never
// opens a real browser.
const openedExternally = [];
if (hidden) globalThis.staveTest = { openedExternally };
function openInBrowser(url) {
  if (!/^https?:/.test(url)) return;
  if (hidden) openedExternally.push(url);
  else shell.openExternal(url);
}

app.setName('Stave');
app.setAppUserModelId('com.saleh.stave'); // groups the taskbar icon and names Stave in Windows' media controls

const settings = createSettings(join(app.getPath('userData'), 'settings.json'));
const serverUrl = () => settings.get('serverUrl') ?? DEFAULT_SERVER;

let win = null;
let tray = null;
let playing = false; // is audio playing in the page? (from the media-* events)
let quitting = false; // set once the app is really quitting, so close stops hiding
let toldAboutTray = false;

app.on('before-quit', () => { quitting = true; });

// One Stave at a time: a second launch just brings the first window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function isServerPage(url) {
  try {
    return new URL(url).origin === new URL(serverUrl()).origin;
  } catch {
    return false;
  }
}

// ---- What the window shows -------------------------------------------------------

const loadServer = () => win.loadURL(serverUrl());
const showSetup = () => win.loadFile(join(PAGES, 'setup.html'));
const showUnreachable = (error) => win.loadFile(join(PAGES, 'unreachable.html'), { query: { server: serverUrl(), error } });

/** Asks a server for /api/health and makes sure it really is Stave. */
async function checkServer(address) {
  let origin;
  try {
    origin = normalizeServerUrl(address);
  } catch (err) {
    return { ok: false, message: err.message };
  }
  try {
    const res = await net.fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== 'ok' || !body.version) {
      return { ok: false, message: `${origin} answered, but it isn't a Stave server.` };
    }
    return { ok: true, origin, version: body.version };
  } catch {
    return { ok: false, message: `Couldn't reach ${origin}. Check the address, and that the server is running.` };
  }
}

// Only the app's own screens may use these.
const fromOwnPage = (event) => event.senderFrame?.url.startsWith(PAGES_URL);
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOwnPage(event)) throw new Error(`${channel} is not available to this page`);
    return fn(...args);
  });
}

handle('stave:get-server', () => ({
  current: settings.get('serverUrl') ?? null,
  suggested: DEFAULT_SERVER,
  configured: Boolean(settings.get('serverUrl')),
}));
handle('stave:check-server', checkServer);
handle('stave:use-server', async (address) => {
  const result = await checkServer(address);
  if (result.ok) {
    settings.set('serverUrl', result.origin);
    loadServer();
  }
  return result;
});
handle('stave:retry', () => loadServer());
handle('stave:change-server', () => showSetup());

// ---- Window ------------------------------------------------------------------------

/**
 * Saves size, position and maximized state, a moment after each change and
 * again on close. While minimized or full screen the window's own state
 * isn't meaningful, so the last real one is kept.
 */
function rememberWindowState(window) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    if (window.isDestroyed()) return;
    const previous = settings.get('window');
    const unusual = window.isMinimized() || window.isFullScreen();
    if (unusual && previous) {
      settings.set('window', stateToSave(window.getNormalBounds(), previous.maximized));
    } else if (!unusual) {
      settings.set('window', stateToSave(window.getNormalBounds(), window.isMaximized()));
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, later);
  window.on('close', save);
}

function createWindow() {
  const saved = settings.get('window');
  // Saved bounds are only used if the window would still be reachable on
  // today's monitors; otherwise it opens centred on the main screen.
  const bounds = restoreBounds(saved, screen.getAllDisplays().map((d) => d.workArea), screen.getPrimaryDisplay().workArea);

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'Stave',
    icon: isDev ? join(ROOT, 'build', 'icon.ico') : undefined, // packaged: the .exe's own icon
    backgroundColor: '#0b0f1a', // no white flash before the page paints
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: !hidden, // hidden test windows keep their timers on time
    },
  });
  if (saved?.maximized) win.maximize();
  rememberWindowState(win);
  if (!hidden) win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  const { webContents } = win;
  // The window only ever shows the Stave server and the app's own screens.
  // Links elsewhere (like the LRCLIB credit) open in the normal browser.
  webContents.on('will-navigate', (event, url) => {
    if (!isServerPage(url)) {
      event.preventDefault();
      openInBrowser(url);
    }
  });
  webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  // Server down, wrong network, wrong address: show the "can't reach Stave" screen.
  webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* ERR_ABORTED: a newer navigation replaced it */ && isServerPage(url)) {
      showUnreachable(description);
    }
  });
  webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') loadServer();
  });

  // While music plays, closing the window only hides it to the tray, so the
  // music keeps going (and media keys keep working). Quitting from the tray,
  // or closing when nothing plays, really quits.
  webContents.on('media-started-playing', () => { playing = true; });
  webContents.on('media-paused', () => { playing = false; });
  webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) playing = false;
  });
  win.on('close', (event) => {
    if (quitting || !playing) return;
    event.preventDefault();
    win.hide();
    if (tray && !toldAboutTray) {
      toldAboutTray = true;
      tray.displayBalloon({ title: 'Stave is still playing', content: 'Click the Stave icon to bring it back, or right-click it to quit.', iconType: 'none' });
    }
  });

  if (settings.get('serverUrl')) loadServer();
  else showSetup();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(join(ROOT, 'assets', 'tray.png')));
  tray.setToolTip('Stave');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Stave', click: showWindow },
    { type: 'separator' },
    { label: 'Change server…', click: () => { showWindow(); showSetup(); } },
    { type: 'separator' },
    { label: 'Quit Stave', role: 'quit' },
  ]));
  tray.on('click', showWindow);
}

function start() {
  // No camera, microphone, notifications or the like: Stave needs none of them.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });

  // Hidden menu: there is no menu bar, but its shortcuts still work.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Stave',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      ...(isDev ? [{ role: 'toggleDevTools' }] : []),
      { type: 'separator' },
      { label: 'Change server…', accelerator: 'CmdOrCtrl+Shift+S', click: () => win && showSetup() },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'quit' },
    ],
  }]));

  createWindow();
  if (!hidden) createTray();
}

app.on('window-all-closed', () => app.quit());
