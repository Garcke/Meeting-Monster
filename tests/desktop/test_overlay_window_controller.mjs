import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import test from 'node:test';

import {
  CAPSULE_BOUNDS,
  OVERLAY_BOUNDS,
  createOverlayWindowController,
} from '../../desktop/dist/main/overlay-window-controller.js';

class FakeWindow extends EventEmitter {
  static created = [];

  constructor(options) {
    super();
    this.options = options;
    this.bounds = {...options.bounds};
    this.visible = options.show ?? false;
    this.destroyed = false;
    this.loadFileCalls = [];
    this.setBoundsCalls = [];
    this.showCalls = 0;
    this.hideCalls = 0;
    FakeWindow.created.push(this);
  }

  getBounds() { return {...this.bounds}; }
  setBounds(bounds, animate) {
    this.setBoundsCalls.push({bounds: {...bounds}, animate});
    this.bounds = {...this.bounds, ...bounds};
    this.emit('move');
  }
  show() { this.showCalls += 1; this.visible = true; }
  hide() { this.hideCalls += 1; this.visible = false; }
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  loadFile(filePath) { this.loadFileCalls.push(filePath); return Promise.resolve(); }
  destroy() { this.destroyed = true; this.emit('closed'); }
  simulateUserMove(bounds) { this.bounds = {...this.bounds, ...bounds}; this.emit('move'); }
}

function createController() {
  FakeWindow.created = [];
  return createOverlayWindowController({
    BrowserWindow: FakeWindow,
    rendererRoot: 'dist/renderer',
    initialCapsuleBounds: {x: 220, y: 120},
  });
}

test('initializes one transparent overlay window at capsule geometry', async () => {
  const controller = createController();
  await controller.initialize();
  const [overlay] = FakeWindow.created;

  assert.equal(FakeWindow.created.length, 1);
  assert.deepEqual(overlay.getBounds(), {x: 220, y: 120, ...CAPSULE_BOUNDS});
  assert.equal(overlay.options.transparent, true);
  assert.equal(overlay.options.frame, false);
  assert.equal(overlay.options.alwaysOnTop, true);
  assert.equal(overlay.options.hasShadow, false);
  assert.equal(overlay.options.backgroundColor, '#00000000');
  assert.equal(overlay.options.webPreferences.backgroundThrottling, false);
  assert.equal(overlay.loadFileCalls[0], path.join('dist/renderer', 'overlay.html'));
  assert.equal(overlay.visible, true);
  assert.deepEqual(controller.getWindow(), overlay);
});

test('opening uses the fixed expanded geometry and does not create another window', async () => {
  const controller = createController();
  await controller.initialize();
  const [overlay] = FakeWindow.created;

  const opening = await controller.dispatch({type: 'toggle-workspace'});
  assert.deepEqual(opening, {target: 'workspace', phase: 'opening', revision: 1});
  assert.deepEqual(overlay.getBounds(), {x: 76, y: 120, ...OVERLAY_BOUNDS});
  assert.equal(FakeWindow.created.length, 1);
  assert.equal(overlay.setBoundsCalls.length, 1);
});

test('destroying the single overlay makes lifecycle callbacks safe no-ops', async () => {
  const controller = createController();
  await controller.initialize();
  const [overlay] = FakeWindow.created;

  overlay.destroy();
  assert.deepEqual(await controller.rendererReady(1), controller.getSnapshot());
  assert.deepEqual(await controller.animationFinished(1), controller.getSnapshot());
  assert.equal(controller.getWindow(), null);
});
