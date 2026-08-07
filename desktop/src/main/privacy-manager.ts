import type {BrowserWindow} from 'electron';
import type {CaptureProtection, PrivacyStatus} from '../shared/contracts';

type PrivacyManagerOptions = {
    platform?: NodeJS.Platform;
    onStatus?: (status: PrivacyStatus) => void;
};

export class WindowPrivacyManager {
    private readonly platform: NodeJS.Platform;
    private readonly onStatus: (status: PrivacyStatus) => void;
    private readonly windows = new Set<BrowserWindow>();
    private readonly captureProtectionByWindow = new Map<BrowserWindow, CaptureProtection>();
    private captureProtectionEnabled = true;

    constructor({platform = process.platform, onStatus = () => {}}: PrivacyManagerOptions = {}) {
        this.platform = platform;
        this.onStatus = onStatus;
    }

    registerWindow(win: BrowserWindow): void {
        this.windows.add(win);
        win.once('closed', () => this.unregisterWindow(win));
        this.applyToWindow(win);
        this.notify();
    }

    unregisterWindow(win: BrowserWindow): void {
        this.windows.delete(win);
        this.captureProtectionByWindow.delete(win);
        this.notify();
    }

    reassertCaptureProtection(): void {
        for (const win of this.windows) this.applyToWindow(win);
        this.notify();
    }

    setCaptureProtection(enabled: boolean): void {
        if (typeof enabled !== 'boolean') throw new TypeError('capture protection state must be boolean');
        this.captureProtectionEnabled = enabled;
        for (const win of this.windows) this.applyToWindow(win);
        this.notify();
    }

    getStatus(): PrivacyStatus {
        return {
            captureProtection: this.aggregateCaptureProtection(),
            captureProtectionEnabled: this.captureProtectionEnabled,
            platform: this.platform,
            windowCount: this.windows.size,
        };
    }

    private applyToWindow(win: BrowserWindow): void {
        if (typeof win.setContentProtection !== 'function') {
            this.captureProtectionByWindow.set(win, 'unsupported');
            return;
        }
        try {
            win.setContentProtection(this.captureProtectionEnabled);
            const protectedState = typeof win.isContentProtected === 'function'
                ? win.isContentProtected()
                : this.captureProtectionEnabled;
            this.captureProtectionByWindow.set(win, this.captureProtectionEnabled
                ? (protectedState ? 'protected' : 'failed')
                : (protectedState ? 'failed' : 'disabled'));
        } catch {
            this.captureProtectionByWindow.set(win, 'failed');
        }
    }

    private aggregateCaptureProtection(): CaptureProtection {
        const states = [...this.captureProtectionByWindow.values()];
        if (states.length === 0) return 'unsupported';
        if (states.includes('failed')) return 'failed';
        if (states.includes('unsupported')) return 'unsupported';
        return this.captureProtectionEnabled ? 'protected' : 'disabled';
    }

    private notify(): void {
        this.onStatus(this.getStatus());
    }
}
