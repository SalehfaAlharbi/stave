import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { restoreBounds } from '../src/window-state.js';
import { setUp, sleep, windowState } from './helpers.js';

// Work areas (screen minus taskbar) of a laptop with a second monitor on its right.
const LAPTOP = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 };

describe('restoreBounds', () => {
  test('keeps saved bounds that are on a screen', () => {
    assert.deepEqual(restoreBounds({ x: 100, y: 80, width: 1100, height: 700 }, [LAPTOP], LAPTOP),
      { x: 100, y: 80, width: 1100, height: 700 });
    assert.deepEqual(restoreBounds({ x: 2000, y: 50, width: 1600, height: 1000 }, [LAPTOP, RIGHT], LAPTOP),
      { x: 2000, y: 50, width: 1600, height: 1000 }, 'on the second monitor');
    assert.deepEqual(restoreBounds({ x: 2000, y: 0, width: 2400, height: 1300 }, [LAPTOP, RIGHT], LAPTOP),
      { x: 2000, y: 0, width: 2400, height: 1300 }, 'bigger than the laptop screen, but it fits the monitor it is on');
  });

  test('re-centres a window whose monitor is gone', () => {
    // Saved on the right-hand monitor, which has since been unplugged.
    assert.deepEqual(restoreBounds({ x: 2000, y: 50, width: 1600, height: 1000 }, [LAPTOP], LAPTOP),
      { x: 160, y: 20, width: 1600, height: 1000 });
  });

  test('re-centres a window whose title strip is off the top or barely on screen', () => {
    assert.equal(restoreBounds({ x: 100, y: -500, width: 1000, height: 700 }, [LAPTOP], LAPTOP).y, 170);
    assert.equal(restoreBounds({ x: 1900, y: 100, width: 1000, height: 700 }, [LAPTOP], LAPTOP).x, 460,
      'only 20 px showing at the right edge is not enough to grab');
  });

  test('shrinks to fit the screen and never goes below the minimum size', () => {
    const small = { x: 0, y: 0, width: 1366, height: 728 };
    assert.deepEqual(restoreBounds({ x: 0, y: 0, width: 2400, height: 1300 }, [small], small),
      { x: 0, y: 0, width: 1366, height: 728 });
    assert.deepEqual(restoreBounds({ x: 10, y: 10, width: 100, height: 100 }, [LAPTOP], LAPTOP),
      { x: 10, y: 10, width: 360, height: 560 });
  });

  test('uses the default size, centred, when nothing (or nonsense) was saved', () => {
    const centred = { x: 320, y: 120, width: 1280, height: 800 };
    assert.deepEqual(restoreBounds(undefined, [LAPTOP], LAPTOP), centred);
    assert.deepEqual(restoreBounds({ x: 'left', y: null, width: 900 }, [LAPTOP], LAPTOP), centred);
  });
});

const savedWindow = (userData) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).window;
const resize = (app, bounds) => app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0].setBounds(b), bounds);
const maximize = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
const primaryWorkArea = (app) => app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);

describe('step 1 (window state): the app remembers its window', () => {
  test('size and position survive a restart', async (t) => {
    const it = await setUp(t);
    const server = await it.server({ signIn: false });
    const userData = await it.profile({ serverUrl: server.base });

    const first = await it.launch(userData);
    const area = await primaryWorkArea(first.app);
    const wanted = { x: area.x + 60, y: area.y + 40, width: 1000, height: 640 };
    await resize(first.app, wanted);
    await sleep(600); // saved shortly after a change
    assert.deepEqual({ ...savedWindow(userData), maximized: undefined }, { ...wanted, maximized: undefined });
    await first.close();

    const second = await it.launch(userData);
    const state = await windowState(second.app);
    assert.deepEqual({ x: state.x, y: state.y, width: state.width, height: state.height }, wanted);
    assert.equal(state.maximized, false);
  });

  test('a maximized window opens maximized, and restores to its last normal size', async (t) => {
    const it = await setUp(t);
    const server = await it.server({ signIn: false });
    const userData = await it.profile({ serverUrl: server.base });

    const first = await it.launch(userData);
    const area = await primaryWorkArea(first.app);
    const normal = { x: area.x + 80, y: area.y + 60, width: 1100, height: 700 };
    await resize(first.app, normal);
    await maximize(first.app);
    await first.close();
    assert.equal(savedWindow(userData).maximized, true);
    assert.equal(savedWindow(userData).width, 1100, 'the normal size is what gets saved');

    const second = await it.launch(userData);
    assert.equal((await windowState(second.app)).maximized, true);
    const restored = await second.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.unmaximize();
      return win.getBounds();
    });
    assert.equal(restored.width, 1100);
    assert.equal(restored.height, 700);
  });

  test('saved bounds that are now off every screen open on the main screen instead', async (t) => {
    const it = await setUp(t);
    const server = await it.server({ signIn: false });
    const userData = await it.profile({ serverUrl: server.base, window: { x: 40000, y: 30000, width: 1000, height: 650, maximized: false } });

    const { app } = await it.launch(userData);
    const state = await windowState(app);
    const area = await primaryWorkArea(app);
    assert.ok(state.x >= area.x && state.x + state.width <= area.x + area.width, `x ${state.x} is on the main screen`);
    assert.ok(state.y >= area.y && state.y + state.height <= area.y + area.height, `y ${state.y} is on the main screen`);
    assert.equal(state.width, 1000, 'the saved size is kept');
  });
});
