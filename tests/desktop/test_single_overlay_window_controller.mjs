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
    FakeWindow.created.push(this);
  }

  getBounds() { return {...this.bounds}; }
  setBounds(bounds, animate) {
    this.setBoundsCalls.push({bounds: {...bounds}, animate});
    this.bounds = {...this.bounds, ...bounds};
    this.emit('move');
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
    initialCapsuleBounds: {x: 220, y: 120},
  });
}

test('creates one overlay window and preserves the capsule anchor while opening', async () => {
  const controller = createController();
  await controller.initialize();

  assert.equal(FakeWindow.created.length, 1);
  const overlay = FakeWindow.created[0];
  assert.deepEqual(overlay.getBounds(), {x: 220, y: 120, width: 360, height: 56});
  assert.equal(overlay.loadFileCalls[0], path.join('dist/renderer', 'overlay.html'));
  assert.deepEqual(controller.getWindow(), overlay);

  await controller.dispatch({type: 'toggle-workspace'});
  assert.deepEqual(overlay.getBounds(), {x: 76, y: 120, width: 648, height: 520});
  assert.equal(overlay.setBoundsCalls.length, 1);
});

test('switching workspace and settings does not resize the single window', async () => {
  const controller = createController();
  await controller.initialize();
  const overlay = FakeWindow.created[0];

  const opened = await controller.dispatch({type: 'toggle-workspace'});
  await controller.rendererReady(opened.revision);
  const callsAfterOpen = overlay.setBoundsCalls.length;

  await controller.dispatch({type: 'toggle-settings'});
  assert.equal(overlay.setBoundsCalls.length, callsAfterOpen);
});

test('closing keeps expanded bounds until the matching animation finishes', async () => {
  const controller = createController();
  await controller.initialize();
  const overlay = FakeWindow.created[0];

  await controller.dispatch({type: 'toggle-workspace'});
  const closing = await controller.dispatch({type: 'toggle-workspace'});
  assert.deepEqual(overlay.getBounds(), {x: 76, y: 120, width: 648, height: 520});

  await controller.animationFinished(closing.revision - 1);
  assert.deepEqual(overlay.getBounds(), {x: 76, y: 120, width: 648, height: 520});

  await controller.animationFinished(closing.revision);
  assert.deepEqual(overlay.getBounds(), {x: 220, y: 120, width: 360, height: 56});
});

test('expanded drag updates the capsule anchor used for the next collapse', async () => {
  const controller = createController();
  await controller.initialize();
  const overlay = FakeWindow.created[0];

  await controller.dispatch({type: 'toggle-workspace'});
  overlay.simulateUserMove({x: 400, y: 300});
  const closing = await controller.dispatch({type: 'toggle-workspace'});
  await controller.animationFinished(closing.revision);

  assert.deepEqual(overlay.getBounds(), {x: 544, y: 300, width: 360, height: 56});
});
