import assert from 'node:assert/strict';
import test from 'node:test';

import {ProgrammaticBoundsTracker} from '../../desktop/dist/main/programmatic-bounds-tracker.js';

const expanded = {x: 0, y: 0, width: 720, height: 520};
const capsule = {x: 180, y: 0, width: 360, height: 56};
const userMove = {x: 240, y: 12, width: 360, height: 56};

test('tracks rapid programmatic bounds in order without classifying stale moves as user drags', () => {
    const tracker = new ProgrammaticBoundsTracker({ttlMs: 250});

    tracker.mark(expanded, 0);
    tracker.mark(capsule, 0);

    assert.equal(tracker.consume(expanded, 10), 'programmatic');
    assert.equal(tracker.consume(capsule, 20), 'programmatic');
    assert.equal(tracker.consume(userMove, 30), 'user');
});

test('expires a missing native bounds event so later user movement is not blocked', () => {
    const tracker = new ProgrammaticBoundsTracker({ttlMs: 250});

    tracker.mark(expanded, 0);

    assert.equal(tracker.consume(userMove, 300), 'user');
});
