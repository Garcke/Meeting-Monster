import path from 'node:path';
import {
    applyOverlayIntent,
    INITIAL_OVERLAY_SNAPSHOT,
    isCurrentOverlayRevision,
} from './overlay-state-machine';
import type {OverlayIntent, OverlaySnapshot} from '../shared/overlay-state';

export const CAPSULE_BOUNDS = {width: 360, height: 56} as const;
export const PANEL_BOUNDS = {width: 648, height: 450} as const;
export const OVERLAY_BOUNDS = {width: 648, height: 520} as const;
export const PANEL_OFFSET = {x: -144, y: 70} as const;

export interface WindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface BrowserWindowLike {
    getBounds(): WindowBounds;
    setBounds(bounds: WindowBounds, animate?: boolean): void;
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

export function createOverlayWindowController(
    options: OverlayWindowControllerOptions,
): OverlayWindowController {
    let overlay: BrowserWindowLike | null = null;
    let snapshot = {...INITIAL_OVERLAY_SNAPSHOT};
    let anchor = {...options.initialCapsuleBounds};
    let expanded = false;
    let disposed = false;

    const isAlive = (): boolean => Boolean(overlay && !overlay.isDestroyed());

    const onMove = (): void => {
        if (!isAlive()) return;
        anchor = anchorFromBounds(overlay!.getBounds(), expanded);
    };

    const onClosed = (): void => {
        overlay = null;
    };

    const setExpandedBounds = (): void => {
        if (!isAlive()) return;
        expanded = true;
        overlay!.setBounds(expandedBounds(anchor), false);
    };

    const setCollapsedBounds = (): void => {
        if (!isAlive()) return;
        expanded = false;
        overlay!.setBounds(collapsedBounds(anchor), false);
    };

    const rendererReady = async (revision: number): Promise<OverlaySnapshot> => {
        if (disposed || !isAlive() || !isCurrentOverlayRevision(snapshot, revision)) return {...snapshot};
        if (snapshot.target !== 'closed') snapshot = {...snapshot, phase: 'visible'};
        return {...snapshot};
    };

    const animationFinished = async (revision: number): Promise<OverlaySnapshot> => {
        if (disposed || !isCurrentOverlayRevision(snapshot, revision)) return {...snapshot};
        if (snapshot.target === 'closed' && snapshot.phase === 'closing') {
            setCollapsedBounds();
            snapshot = {...snapshot, phase: 'hidden'};
        }
        return {...snapshot};
    };

    return {
        async initialize(): Promise<void> {
            if (disposed || overlay) return;
            const initial = collapsedBounds(anchor);
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
                webPreferences: {
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: false,
                    backgroundThrottling: false,
                },
            }, options.preloadPath));
            options.onWindowCreated?.(overlay);
            overlay.on('move', onMove);
            overlay.on('closed', onClosed);
            await overlay.loadFile(rendererFile(options.rendererRoot, 'overlay'));
            if (isAlive()) overlay!.show();
        },

        async dispatch(intent: OverlayIntent): Promise<OverlaySnapshot> {
            if (disposed || !isAlive()) return {...snapshot};
            const wasExpanded = expanded;
            const next = applyOverlayIntent(snapshot, intent);
            if (next.target !== 'closed' && !expanded) setExpandedBounds();
            snapshot = next.target !== 'closed' && wasExpanded
                ? {...next, phase: 'visible'}
                : next;
            return {...snapshot};
        },

        rendererReady,
        animationFinished,

        getSnapshot(): OverlaySnapshot { return {...snapshot}; },

        getWindow(): BrowserWindowLike | null { return overlay; },

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

export function rendererFile(root: string, entry: 'overlay' | 'capsule' | 'panel'): string {
    return path.join(root, `${entry}.html`);
}
