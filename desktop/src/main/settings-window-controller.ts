import path from 'node:path';

export interface SettingsBrowserWindowLike {
    isDestroyed(): boolean;
    isMinimized(): boolean;
    restore(): void;
    show(): void;
    focus(): void;
    destroy(): void;
    loadFile(filePath: string): Promise<unknown>;
    on(event: 'closed', listener: () => void): void;
    removeListener(event: 'closed', listener: () => void): void;
}

export interface SettingsWindowController {
    open(): Promise<SettingsBrowserWindowLike>;
    close(): void;
    getWindow(): SettingsBrowserWindowLike | null;
    dispose(): void;
}

export type SettingsBrowserWindowConstructor = new (
    options: Record<string, unknown>,
) => SettingsBrowserWindowLike;

export interface SettingsWindowControllerOptions {
    BrowserWindow: SettingsBrowserWindowConstructor;
    rendererRoot: string;
    preloadPath: string;
    windowIconPath: string;
    onWindowCreated?: (window: SettingsBrowserWindowLike) => void;
}

export function createSettingsWindowController(
    options: SettingsWindowControllerOptions,
): SettingsWindowController {
    let window: SettingsBrowserWindowLike | null = null;
    let openingPromise: Promise<SettingsBrowserWindowLike> | null = null;
    let disposed = false;

    const close = (): void => {
        const current = window;
        window = null;
        if (current && !current.isDestroyed()) current.destroy();
    };

    return {
        open(): Promise<SettingsBrowserWindowLike> {
            if (disposed) return Promise.reject(new Error('Settings window controller is disposed'));
            if (openingPromise) return openingPromise;

            if (window && !window.isDestroyed()) {
                if (window.isMinimized()) window.restore();
                window.show();
                window.focus();
                return Promise.resolve(window);
            }

            const next = new options.BrowserWindow({
                width: 940,
                height: 640,
                minWidth: 760,
                minHeight: 520,
                center: true,
                title: 'Meeting-Monster 设置',
                show: false,
                frame: false,
                autoHideMenuBar: true,
                transparent: false,
                backgroundColor: '#111721',
                resizable: true,
                minimizable: true,
                maximizable: false,
                skipTaskbar: false,
                icon: options.windowIconPath,
                webPreferences: {
                    preload: options.preloadPath,
                    contextIsolation: true,
                    nodeIntegration: false,
                    webSecurity: true,
                    sandbox: false,
                    backgroundThrottling: false,
                },
            });
            window = next;
            options.onWindowCreated?.(next);

            const onClosed = (): void => {
                if (window === next) window = null;
            };
            next.on('closed', onClosed);

            openingPromise = (async (): Promise<SettingsBrowserWindowLike> => {
                try {
                    await next.loadFile(path.join(options.rendererRoot, 'settings.html'));
                    if (window === next && !next.isDestroyed()) {
                        next.show();
                        next.focus();
                    }
                    return next;
                } catch {
                    next.removeListener('closed', onClosed);
                    if (!next.isDestroyed()) next.destroy();
                    if (window === next) window = null;
                    throw new Error('Settings renderer failed to load');
                } finally {
                    openingPromise = null;
                }
            })();

            return openingPromise;
        },

        close,

        getWindow(): SettingsBrowserWindowLike | null {
            return window;
        },

        dispose(): void {
            if (disposed) return;
            disposed = true;
            openingPromise = null;
            close();
        },
    };
}
