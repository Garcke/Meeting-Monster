import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAnchorFromExpandedBounds,
  getCapsuleBounds,
  getExpandedBounds,
} from '../../desktop/dist/main/window-geometry.js';

test('expands horizontally around the capsule and keeps its y position', () => {
  const anchor = {x: 100, y: 40, width: 80, height: 32};
  const expandedSize = {width: 400, height: 300};
  const workArea = {x: 0, y: 0, width: 1200, height: 900};

  assert.deepEqual(getExpandedBounds(anchor, expandedSize, workArea), {
    x: -60,
    y: 40,
    width: 400,
    height: 300,
  });
});

test('moves only expanded y upward when it would cross the work area bottom', () => {
  const anchor = {x: 700, y: 700, width: 80, height: 32};
  const expandedSize = {width: 400, height: 300};
  const workArea = {x: 0, y: 0, width: 1200, height: 900};

  assert.deepEqual(getExpandedBounds(anchor, expandedSize, workArea), {
    x: 540,
    y: 600,
    width: 400,
    height: 300,
  });
  assert.deepEqual(anchor, {x: 700, y: 700, width: 80, height: 32});
});

test('returns an exact copy of the capsule anchor when collapsed', () => {
  const anchor = {x: 12, y: 34, width: 80, height: 32};

  const capsule = getCapsuleBounds(anchor);

  assert.deepEqual(capsule, anchor);
  assert.notStrictEqual(capsule, anchor);
});

test('derives the capsule anchor from an expanded bounds position', () => {
  const expandedBounds = {x: 540, y: 600, width: 400, height: 300};
  const capsuleSize = {width: 80, height: 32};

  assert.deepEqual(getAnchorFromExpandedBounds(expandedBounds, capsuleSize), {
    x: 700,
    y: 600,
    width: 80,
    height: 32,
  });
});
