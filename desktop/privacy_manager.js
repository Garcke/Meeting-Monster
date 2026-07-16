'use strict';

class WindowPrivacyManager {
    constructor({platform = process.platform, onStatus = () => {}} = {}) {
        this.platform = platform;
        this.onStatus = onStatus;
        this.windows = new Set();
        this.captureProtection = platform === 'win32' ? 'protected' : 'unsupported';
        this.redaction = 'off';
    }

    registerWindow(win) {
        this.windows.add(win);
        if (typeof win.once === 'function') {
            win.once('closed', () => this.unregisterWindow(win));
        }
        this._applyToWindow(win);
        this._notify();
    }

    unregisterWindow(win) {
        this.windows.delete(win);
        this._notify();
    }

    reassertCaptureProtection() {
        for (const win of this.windows) {
            this._applyToWindow(win);
        }
        this._notify();
    }

    setRedacted(enabled) {
        this.redaction = enabled ? 'on' : 'off';
        this._notify();
    }

    toggleRedacted() {
        this.setRedacted(this.redaction !== 'on');
    }

    getStatus() {
        return {
            captureProtection: this.captureProtection,
            redaction: this.redaction,
            platform: this.platform,
            windowCount: this.windows.size,
        };
    }

    _applyToWindow(win) {
        if (this.platform !== 'win32' || typeof win.setContentProtection !== 'function') {
            this.captureProtection = 'unsupported';
            return;
        }

        try {
            win.setContentProtection(true);
            const protectedState = typeof win.isContentProtected !== 'function'
                || win.isContentProtected();
            this.captureProtection = protectedState ? 'protected' : 'failed';
        } catch {
            this.captureProtection = 'failed';
        }
    }

    _notify() {
        this.onStatus(this.getStatus());
    }
}

module.exports = {WindowPrivacyManager};
