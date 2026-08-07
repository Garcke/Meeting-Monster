import path from 'node:path';
import {
    applyOverlayIntent,
    INITIAL_OVERLAY_SNAPSHOT,
    isCurrentOverlayRevision,
} from './overlay-state-machine';
import type {OverlayIntent, OverlaySnapshot} from '../shared/overlay-state';

export const CAPSULE_BOUNDS = {width: 248, height: 48} as const;
export const PANEL_BOUNDS = {width: 648, height: 450} as const;
export const OVERLAY_BOUNDS = {width: 648, height: 512} as const;
export const PANEL_OFFSET = {x: -200, y: 62} as const;
export const CAPSULE_SHAPE = {x: -PANEL_OFFSET.x, y: 0, ...CAPSULE_BOUNDS} as const;
export const PANEL_SHAPE = {x: 0, y: PANEL_OFFSET.y, ...PANEL_BOUNDS} as const;

export interface WindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface BrowserWindowLike {
    getBounds(): WindowBounds;
    setBounds(bounds: WindowBounds, animate?: boolean): void;
    setShape(rects: WindowBounds[]): void;
    show(): void;
    hide(): void;
    isDestroyed(): boolean;
    loadFile(filePath: string): Promise<unknown>;
    on(event: 'move' | 'closed', listener: () => void): void;
    removeListener(event: 'move' | 'closed', listener: () => void): void;
    destroy?(): void;
    isVisible?(): boolean;
}

export type BrowserWindowConstructor = new (options: Record<string, unknown>) => BrowserWindowLike;

export interface OverlayWindowControllerOptions {
    BrowserWindow: BrowserWindowConstructor;
    rendererRoot: string;
    initialCapsuleBounds: {x: number; y: number};
    windowIconPath: string;
    preloadPath?: string;
    onWindowCreated?: (window: BrowserWindowLike) => void;
}

export interface OverlayWindowController {
    initialize(): Promise<void>;
    dispatch(intent: OverlayIntent): Promise<OverlaySnapshot>;
    rendererReady(revision: number): Promise<OverlaySnapshot>;
    animationFinished(revision: number): Promise<OverlaySnapshot>;
    getSnapshot(): OverlaySnapshot;
    getWindow(): BrowserWindowLike | null;
    moveBy(delta: {x: number; y: number}, workArea: WindowBounds): WindowBounds | null;
    /** Transitional read API for main-process callers being migrated in the next slice. */
    getWindows(): {capsule: BrowserWindowLike | null; panel: null};
    /** Transitional aliases retained until preload/main IPC is migrated. */
    panelReady(revision: number): Promise<OverlaySnapshot>;
    panelAnimationFinished(revision: number): Promise<OverlaySnapshot>;
    dispose(): void;
}

function withPreload(options: Record<string, unknown>, preloadPath?: string): Record<string, unknown> {
    if (!preloadPath) return options;
    return {
        ...options,
        webPreferences: {
            ...(options.webPreferences as Record<string, unknown> | undefined),
            preload: preloadPath,
        },
    };
}

export function collapsedBounds(anchor: {x: number; y: number}): WindowBounds {
    return {...anchor, ...CAPSULE_BOUNDS};
}

export function expandedBounds(anchor: {x: number; y: number}): WindowBounds {
    return {
        x: anchor.x + PANEL_OFFSET.x,
        y: anchor.y,
        ...OVERLAY_BOUNDS,
    };
}

export function anchorFromBounds(bounds: WindowBounds, expanded: boolean): {x: number; y: number} {
    return {
        x: expanded ? bounds.x - PANEL_OFFSET.x : bounds.x,
        y: bounds.y,
    };
}

export function clampAnchorToWorkArea(
    anchor: {x: number; y: number},
    workArea: WindowBounds,
    expanded: boolean,
): {x: number; y: number} {
    const minX = expanded ? workArea.x - PANEL_OFFSET.x : workArea.x;
    const maxX = expanded
        ? workArea.x + workArea.width - OVERLAY_BOUNDS.width - PANEL_OFFSET.x
        : workArea.x + workArea.width - CAPSULE_BOUNDS.width;
    const minY = workArea.y;
    const maxY = workArea.y + workArea.height
        - (expanded ? OVERLAY_BOUNDS.height : CAPSULE_BOUNDS.height);
    return {
        x: Math.min(Math.max(anchor.x, minX), Math.max(minX, maxX)),
        y: Math.min(Math.max(anchor.y, minY), Math.max(minY, maxY)),
    };
}

export function createOverlayWindowController(
    options: OverlayWindowControllerOptions,
): OverlayWindowController {
    let overlay: BrowserWindowLike | null = null;
    let snapshot = {...INITIAL_OVERLAY_SNAPSHOT};
    let anchor = {...options.initialCapsuleBounds};
    let panelVisible = false;
    let disposed = false;

    const isAlive = (): boolean => Boolean(overlay && !overlay.isDestroyed());

    const onMove = (): void => {
        if (!isAlive()) return;
        anchor = anchorFromBounds(overlay!.getBounds(), true);
    };

    const onClosed = (): void => {
        overlay = null;
    };

    const setPanelVisible = (visible: boolean): void => {
        if (!isAlive()) return;
        panelVisible = visible;
        overlay!.setShape(visible
            ? [{...CAPSULE_SHAPE}, {...PANEL_SHAPE}]
            : [{...CAPSULE_SHAPE}]);
    };

    const rendererReady = async (revision: number): Promise<OverlaySnapshot> => {
        if (disposed || !isAlive() || !isCurrentOverlayRevision(snapshot, revision)) return {...snapshot};
        if (snapshot.target !== 'closed') snapshot = {...snapshot, phase: 'visible'};
        return {...snapshot};
    };

    const animationFinished = async (revision: number): Promise<OverlaySnapshot> => {
        if (disposed || !isCurrentOverlayRevision(snapshot, revision)) return {...snapshot};
        if (snapshot.target === 'closed' && snapshot.phase === 'closing') {
            setPanelVisible(false);
            snapshot = {...snapshot, phase: 'hidden'};
        }
        return {...snapshot};
    };

    return {
        async initialize(): Promise<void> {
            if (disposed || overlay) return;
            const initial = expandedBounds(anchor);
            overlay = new options.BrowserWindow(withPreload({
                x: initial.x,
                y: initial.y,
                width: initial.width,
                height: initial.height,
                bounds: initial,
                show: false,
                transparent: true,
                frame: false,
                alwaysOnTop: true,
                hasShadow: false,
                backgroundColor: '#00000000',
                resizable: false,
                icon: options.windowIconPath,
                skipTaskbar: true,
                webPreferences: {
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: false,
                    backgroundThrottling: false,
                },
            }, options.preloadPath));
            setPanelVisible(false);
            options.onWindowCreated?.(overlay);
            overlay.on('move', onMove);
            overlay.on('closed', onClosed);
            await overlay.loadFile(rendererFile(options.rendererRoot, 'overlay'));
            if (isAlive()) overlay!.show();
        },

        async dispatch(intent: OverlayIntent): Promise<OverlaySnapshot> {
            if (disposed || !isAlive()) return {...snapshot};
            const wasPanelVisible = panelVisible;
            const next = applyOverlayIntent(snapshot, intent);
            if (next.target !== 'closed' && !panelVisible) setPanelVisible(true);
            snapshot = next.target !== 'closed' && wasPanelVisible
                ? {...next, phase: 'visible'}
                : next;
            return {...snapshot};
        },

        rendererReady,
        animationFinished,

        getSnapshot(): OverlaySnapshot { return {...snapshot}; },

        getWindow(): BrowserWindowLike | null { return overlay; },

        moveBy(delta: {x: number; y: number}, workArea: WindowBounds): WindowBounds | null {
            if (!isAlive()) return null;
            anchor = clampAnchorToWorkArea(
                {x: anchor.x + delta.x, y: anchor.y + delta.y},
                workArea,
                snapshot.target === 'workspace',
            );
            const bounds = expandedBounds(anchor);
            overlay!.setBounds(bounds, false);
            return bounds;
        },

        getWindows(): {capsule: BrowserWindowLike | null; panel: null} {
            return {capsule: overlay, panel: null};
        },

        panelReady: rendererReady,
        panelAnimationFinished: animationFinished,

        dispose(): void {
            if (disposed) return;
            disposed = true;
            if (overlay && !overlay.isDestroyed()) {
                overlay.removeListener('move', onMove);
                overlay.removeListener('closed', onClosed);
                overlay.destroy?.();
            }
            overlay = null;
        },
    };
}

export function rendererFile(root: string, entry: 'overlay'): string {
    return path.join(root, `${entry}.html`);
}
