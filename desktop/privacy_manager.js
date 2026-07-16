'use strict';

class WindowPrivacyManager {
    constructor({platform = process.platform, onStatus = () => {}} = {}) {
        this.platform = platform;
        this.onStatus = onStatus;
        this.windows = new Set();
        this.captureProtection = 'unsupported';
        this.captureProtectionEnabled = true;
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

    setCaptureProtection(enabled) {
        if (typeof enabled !== 'boolean') throw new TypeError('capture protection state must be boolean');
        this.captureProtectionEnabled = enabled;
        for (const win of this.windows) {
            this._applyToWindow(win);
        }
        this._notify();
    }

    getStatus() {
        return {
            captureProtection: this.captureProtection,
            captureProtectionEnabled: this.captureProtectionEnabled,
            platform: this.platform,
            windowCount: this.windows.size,
        };
    }

    _applyToWindow(win) {
        if (typeof win.setContentProtection !== 'function') {
            this.captureProtection = 'unsupported';
            return;
        }

        try {
            win.setContentProtection(this.captureProtectionEnabled);
            const protectedState = typeof win.isContentProtected !== 'function'
                ? this.captureProtectionEnabled
                : win.isContentProtected();
            this.captureProtection = this.captureProtectionEnabled
                ? (protectedState ? 'protected' : 'failed')
                : (protectedState ? 'failed' : 'disabled');
        } catch {
            this.captureProtection = 'failed';
        }
    }

    _notify() {
        this.onStatus(this.getStatus());
    }
}

module.exports = {WindowPrivacyManager};
