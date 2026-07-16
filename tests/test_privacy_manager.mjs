import test from 'node:test';
import assert from 'node:assert/strict';
import {WindowPrivacyManager} from '../desktop/privacy_manager.js';

function fakeWindow({protectedState = true, throws = false} = {}) {
    return {
        calls: 0,
        setContentProtection(enabled) {
            this.calls += 1;
            if (throws) throw new Error('SetWindowDisplayAffinity failed');
            this.protectedState = enabled;
        },
        isContentProtected() {
            return this.protectedState;
        },
        once() {},
    };
}

test('protects registered Windows windows and reports protected', () => {
    const win = fakeWindow();
    const manager = new WindowPrivacyManager({platform: 'win32'});
    manager.registerWindow(win);
    assert.equal(win.calls, 1);
    assert.equal(manager.getStatus().captureProtection, 'protected');
});

test('does not call capture API on unsupported platforms', () => {
    const win = fakeWindow();
    const manager = new WindowPrivacyManager({platform: 'linux'});
    manager.registerWindow(win);
    assert.equal(win.calls, 0);
    assert.equal(manager.getStatus().captureProtection, 'unsupported');
});

test('reports failed when the OS call throws', () => {
    const manager = new WindowPrivacyManager({platform: 'win32'});
    manager.registerWindow(fakeWindow({throws: true}));
    assert.equal(manager.getStatus().captureProtection, 'failed');
});

test('redaction is independent from capture protection', () => {
    const manager = new WindowPrivacyManager({platform: 'win32'});
    manager.setRedacted(true);
    assert.equal(manager.getStatus().redaction, 'on');
    manager.toggleRedacted();
    assert.equal(manager.getStatus().redaction, 'off');
});

test('reasserts protection for every registered window', () => {
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
