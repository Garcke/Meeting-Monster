import test from 'node:test';
import assert from 'node:assert/strict';
import {WindowPrivacyManager} from '../../desktop/dist/main/privacy-manager.js';

function fakeWindow({protectedState = true, throws = false, supported = true} = {}) {
    let onClosed = () => {};
    return {
        calls: 0,
        setContentProtection(enabled) {
            if (!supported) throw new Error('unsupported');
            this.calls += 1;
            if (throws) throw new Error('capture protection failed');
            this.protectedState = enabled;
        },
        isContentProtected() {
            return this.protectedState;
        },
        once(event, listener) {
            if (event === 'closed') onClosed = listener;
        },
        close() { onClosed(); },
    };
}

test('applies Electron content protection on registration', () => {
    const win = fakeWindow();
    const manager = new WindowPrivacyManager({platform: 'darwin'});

    manager.registerWindow(win);

    assert.equal(win.calls, 1);
    assert.equal(manager.getStatus().captureProtection, 'protected');
});

test('reports unsupported when the Electron capability is missing', () => {
    const win = {once() {}};
    const manager = new WindowPrivacyManager({platform: 'linux'});

    manager.registerWindow(win);

    assert.equal(manager.getStatus().captureProtection, 'unsupported');
});

test('reports failed when Electron content protection throws', () => {
    const manager = new WindowPrivacyManager({platform: 'win32'});

    manager.registerWindow(fakeWindow({throws: true}));

    assert.equal(manager.getStatus().captureProtection, 'failed');
});

test('aggregates mixed window results without letting a later protected window hide a failure', () => {
    const manager = new WindowPrivacyManager({platform: 'win32'});
    const failed = fakeWindow({throws: true});
    const protectedWindow = fakeWindow();

    manager.registerWindow(failed);
    manager.registerWindow(protectedWindow);

    assert.equal(manager.getStatus().captureProtection, 'failed');
    assert.equal(manager.getStatus().windowCount, 2);

    failed.close();
    assert.equal(manager.getStatus().captureProtection, 'protected');
    assert.equal(manager.getStatus().windowCount, 1);
});

test('aggregates unsupported with protected windows until the unsupported window closes', () => {
    const manager = new WindowPrivacyManager({platform: 'linux'});
    const unsupported = {once(event, listener) { if (event === 'closed') this.onClosed = listener; }};

    manager.registerWindow(unsupported);
    manager.registerWindow(fakeWindow());
    assert.equal(manager.getStatus().captureProtection, 'unsupported');

    unsupported.onClosed();
    assert.equal(manager.getStatus().captureProtection, 'protected');
});

test('reasserts content protection for every registered window', () => {
    const first = fakeWindow();
    const second = fakeWindow();
    const manager = new WindowPrivacyManager({platform: 'win32'});
    manager.registerWindow(first);
    manager.registerWindow(second);
    first.calls = 0;
    second.calls = 0;

    manager.reassertCaptureProtection();

    assert.equal(first.calls, 1);
    assert.equal(second.calls, 1);
});

test('capture protection defaults on and can be toggled by the capsule', () => {
    const manager = new WindowPrivacyManager({platform: 'win32'});
    const win = fakeWindow();
    manager.registerWindow(win);

    assert.equal(manager.getStatus().captureProtection, 'protected');
    assert.equal('redaction' in manager.getStatus(), false);

    manager.setCaptureProtection(false);
    assert.equal(win.protectedState, false);
    assert.equal(manager.getStatus().captureProtection, 'disabled');

    manager.setCaptureProtection(true);
    assert.equal(win.protectedState, true);
    assert.equal(manager.getStatus().captureProtection, 'protected');
});
