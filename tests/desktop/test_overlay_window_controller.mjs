import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import test from 'node:test';

import {
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
    this.setShapeCalls = [];
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
  setShape(rects) {
    this.setShapeCalls.push(rects.map((rect) => ({...rect})));
  }
  show() { this.showCalls += 1; this.visible = true; }
  hide() { this.hideCalls += 1; this.visible = false; }
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  loadFile(filePath) { this.loadFileCalls.push(filePath); return Promise.resolve(); }
  destroy() { this.destroyed = true; this.emit('closed'); }
  simulateUserMove(bounds) { this.bounds = {...this.bounds, ...bounds}; this.emit('move'); }
  simulateUserMoved(bounds) { this.bounds = {...this.bounds, ...bounds}; this.emit('moved'); }
}

function createController() {
  FakeWindow.created = [];
  return createOverlayWindowController({
    BrowserWindow: FakeWindow,
    rendererRoot: 'dist/renderer',
    windowIconPath: path.join('renderer', 'favicon.ico'),
    initialCapsuleBounds: {x: 220, y: 120},
  });
}

test('initializes one transparent overlay at fixed geometry with only the capsule shaped in', async () => {
  const controller = createController();
  await controller.initialize();
  const [overlay] = FakeWindow.created;

  assert.equal(FakeWindow.created.length, 1);
  assert.deepEqual(overlay.getBounds(), {x: 20, y: 120, ...OVERLAY_BOUNDS});
  assert.deepEqual(overlay.setShapeCalls, [[{x: 200, y: 0, width: 248, height: 48}]]);
  assert.equal(overlay.options.transparent, true);
  assert.equal(overlay.options.frame, false);
  assert.equal(overlay.options.alwaysOnTop, true);
  assert.equal(overlay.options.hasShadow, false);
  assert.equal(overlay.options.backgroundColor, '#00000000');
  assert.equal(overlay.options.skipTaskbar, true);
  assert.equal(overlay.options.icon, path.join('renderer', 'favicon.ico'));
  assert.equal(overlay.options.webPreferences.backgroundThrottling, false);
  assert.equal(overlay.loadFileCalls[0], path.join('dist/renderer', 'overlay.html'));
  assert.equal(overlay.visible, true);
  assert.deepEqual(controller.getWindow(), overlay);
});

test('opening changes the native shape without moving or resizing the fixed window', async () => {
  const controller = createController();
  await controller.initialize();
  const [overlay] = FakeWindow.created;

  const opening = await controller.dispatch({type: 'toggle-workspace'});
  assert.deepEqual(opening, {target: 'workspace', phase: 'opening', revision: 1});
  assert.deepEqual(overlay.getBounds(), {x: 20, y: 120, ...OVERLAY_BOUNDS});
  assert.equal(FakeWindow.created.length, 1);
  assert.equal(overlay.setBoundsCalls.length, 0);
  assert.deepEqual(overlay.setShapeCalls.at(-1), [
    {x: 200, y: 0, width: 248, height: 48},
    {x: 0, y: 62, width: 648, height: 450},
  ]);
});

test('replays the expanded capsule and panel shapes after a cross-display move', async () => {
  const controller = createController();
  await controller.initialize();
  const [overlay] = FakeWindow.created;
  await controller.dispatch({type: 'toggle-workspace'});
  const shapeCallsBeforeMove = overlay.setShapeCalls.length;

  overlay.simulateUserMoved({x: 400, y: 300});

  assert.equal(overlay.setShapeCalls.length, shapeCallsBeforeMove + 1);
  assert.deepEqual(overlay.setShapeCalls.at(-1), [
    {x: 200, y: 0, width: 248, height: 48},
    {x: 0, y: 62, width: 648, height: 450},
  ]);
  assert.deepEqual(overlay.getBounds(), {x: 400, y: 300, ...OVERLAY_BOUNDS});
  assert.equal(overlay.setBoundsCalls.length, 0);
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
