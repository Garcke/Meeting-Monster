import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import test from 'node:test';

import {createSettingsWindowController} from '../../desktop/dist/main/settings-window-controller.js';

class FakeWindow extends EventEmitter {
  static created = [];
  static deferLoad = false;
  static failFirstLoad = false;

  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.minimized = false;
    this.loadFileCalls = [];
    this.showCalls = 0;
    this.focusCalls = 0;
    this.restoreCalls = 0;
    FakeWindow.created.push(this);
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  restore() { this.restoreCalls += 1; this.minimized = false; }
  show() { this.showCalls += 1; }
  focus() { this.focusCalls += 1; }
  destroy() { this.destroyed = true; this.emit('closed'); }
  loadFile(filePath) {
    this.loadFileCalls.push(filePath);
    if (FakeWindow.failFirstLoad && FakeWindow.created.length === 1) {
      return Promise.reject(new Error('first renderer load failed'));
    }
    if (!FakeWindow.deferLoad) return Promise.resolve();
    return new Promise((resolve) => { this.resolveLoad = resolve; });
  }
}

function createController({deferLoad = false, failFirstLoad = false} = {}) {
  FakeWindow.created = [];
  FakeWindow.deferLoad = deferLoad;
  FakeWindow.failFirstLoad = failFirstLoad;
  return createSettingsWindowController({
    BrowserWindow: FakeWindow,
    rendererRoot: 'dist/renderer',
    preloadPath: 'dist/preload/settings.js',
    windowIconPath: path.join('renderer', 'favicon.ico'),
  });
}

test('creates one secured settings window and loads settings.html', async () => {
  const controller = createController();
  const first = await controller.open();

  assert.equal(FakeWindow.created.length, 1);
  assert.equal(first.options.width, 940);
  assert.equal(first.options.height, 640);
  assert.equal(first.options.minWidth, 760);
  assert.equal(first.options.minHeight, 520);
  assert.equal(first.options.frame, false);
  assert.equal(first.options.skipTaskbar, false);
  assert.equal(first.options.maximizable, false);
  assert.equal(first.options.title, 'Meeting-Monster 设置');
  assert.equal(first.options.autoHideMenuBar, true);
  assert.equal(first.options.webPreferences.contextIsolation, true);
  assert.equal(first.options.webPreferences.nodeIntegration, false);
  assert.equal(first.options.webPreferences.webSecurity, true);
  assert.equal(first.options.webPreferences.preload, 'dist/preload/settings.js');
  assert.deepEqual(first.loadFileCalls, [path.join('dist/renderer', 'settings.html')]);
  assert.equal(first.showCalls, 1);
  assert.equal(first.focusCalls, 1);
});

test('restores and focuses the existing settings window', async () => {
  const controller = createController();
  const first = await controller.open();
  first.minimized = true;
  const second = await controller.open();

  assert.equal(second, first);
  assert.equal(FakeWindow.created.length, 1);
  assert.equal(first.restoreCalls, 1);
  assert.equal(first.focusCalls, 2);
});

test('coalesces concurrent opens until the first local renderer load finishes', async () => {
  const controller = createController({deferLoad: true});
  const firstOpen = controller.open();
  const secondOpen = controller.open();
  assert.equal(FakeWindow.created.length, 1);
  FakeWindow.created[0].resolveLoad();
  const [first, second] = await Promise.all([firstOpen, secondOpen]);
  assert.equal(first, second);
  assert.equal(first.showCalls, 1);
});

test('clears a failed load so the next open can retry', async () => {
  const controller = createController({failFirstLoad: true});
  await assert.rejects(controller.open(), /settings renderer failed/i);
  assert.equal(controller.getWindow(), null);
  await controller.open();
  assert.equal(FakeWindow.created.length, 2);
});
