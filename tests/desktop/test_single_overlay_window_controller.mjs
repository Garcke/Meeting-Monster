import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import test from 'node:test';

import {createOverlayWindowController} from '../../desktop/dist/main/overlay-window-controller.js';

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
  show() { this.visible = true; }
  hide() { this.visible = false; }
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
    windowIconPath: path.join('renderer', 'favicon.ico'),
    initialCapsuleBounds: {x: 220, y: 120},
  });
}

test('keeps one fixed native window while opening the panel around the capsule anchor', async () => {
  const controller = createController();
  await controller.initialize();

  assert.equal(FakeWindow.created.length, 1);
  const overlay = FakeWindow.created[0];
  assert.deepEqual(overlay.getBounds(), {x: 20, y: 120, width: 648, height: 512});
  assert.deepEqual(overlay.setShapeCalls, [
    [{x: 200, y: 0, width: 248, height: 48}],
  ]);
  assert.equal(overlay.loadFileCalls[0], path.join('dist/renderer', 'overlay.html'));
  assert.deepEqual(controller.getWindow(), overlay);

  await controller.dispatch({type: 'toggle-workspace'});
  assert.deepEqual(overlay.getBounds(), {x: 20, y: 120, width: 648, height: 512});
  assert.equal(overlay.setBoundsCalls.length, 0);
  assert.deepEqual(overlay.setShapeCalls.at(-1), [
    {x: 200, y: 0, width: 248, height: 48},
    {x: 0, y: 62, width: 648, height: 450},
  ]);
});

test('toggling the workspace does not resize the single window', async () => {
  const controller = createController();
  await controller.initialize();
  const overlay = FakeWindow.created[0];

  const opened = await controller.dispatch({type: 'toggle-workspace'});
  await controller.rendererReady(opened.revision);
  const callsAfterOpen = overlay.setBoundsCalls.length;

  await controller.dispatch({type: 'toggle-workspace'});
  await controller.animationFinished(controller.getSnapshot().revision);
  await controller.dispatch({type: 'toggle-workspace'});
  assert.equal(overlay.setBoundsCalls.length, callsAfterOpen);
  assert.deepEqual(overlay.getBounds(), {x: 20, y: 120, width: 648, height: 512});
});

test('closing keeps fixed bounds and clips the panel only after the matching animation finishes', async () => {
  const controller = createController();
  await controller.initialize();
  const overlay = FakeWindow.created[0];

  await controller.dispatch({type: 'toggle-workspace'});
  const closing = await controller.dispatch({type: 'toggle-workspace'});
  assert.deepEqual(overlay.getBounds(), {x: 20, y: 120, width: 648, height: 512});

  await controller.animationFinished(closing.revision - 1);
  assert.deepEqual(overlay.getBounds(), {x: 20, y: 120, width: 648, height: 512});

  await controller.animationFinished(closing.revision);
  assert.deepEqual(overlay.getBounds(), {x: 20, y: 120, width: 648, height: 512});
  assert.equal(overlay.setBoundsCalls.length, 0);
  assert.deepEqual(overlay.setShapeCalls.at(-1), [
    {x: 200, y: 0, width: 248, height: 48},
  ]);
});

test('a user drag is not reversed when the fixed window collapses', async () => {
  const controller = createController();
  await controller.initialize();
  const overlay = FakeWindow.created[0];

  await controller.dispatch({type: 'toggle-workspace'});
  overlay.simulateUserMove({x: 400, y: 300});
  const closing = await controller.dispatch({type: 'toggle-workspace'});
  await controller.animationFinished(closing.revision);

  assert.deepEqual(overlay.getBounds(), {x: 400, y: 300, width: 648, height: 512});
  assert.equal(overlay.setBoundsCalls.length, 0);
});

test('moves a collapsed capsule within its visible work area while retaining expanded native bounds', async () => {
  const controller = createController();
  await controller.initialize();
  const overlay = FakeWindow.created[0];
  const workArea = {x: 0, y: 0, width: 1920, height: 1080};

  assert.deepEqual(
    controller.moveBy({x: -24, y: 24}, workArea),
    {x: -4, y: 144, width: 648, height: 512},
  );
  assert.deepEqual(
    controller.moveBy({x: -10_000, y: -10_000}, workArea),
    {x: -200, y: 0, width: 648, height: 512},
  );
  assert.deepEqual(overlay.getBounds(), {x: -200, y: 0, width: 648, height: 512});
});

test('keeps the full expanded overlay within the work area while moving toward every edge', async () => {
  const controller = createController();
  await controller.initialize();
  const overlay = FakeWindow.created[0];
  const workArea = {x: 0, y: 0, width: 1920, height: 1080};
  await controller.dispatch({type: 'toggle-workspace'});

  assert.deepEqual(
    controller.moveBy({x: -10_000, y: -10_000}, workArea),
    {x: 0, y: 0, width: 648, height: 512},
  );
  assert.deepEqual(
    controller.moveBy({x: 10_000, y: 10_000}, workArea),
    {x: 1272, y: 568, width: 648, height: 512},
  );
  assert.deepEqual(overlay.getBounds(), {x: 1272, y: 568, width: 648, height: 512});
});
