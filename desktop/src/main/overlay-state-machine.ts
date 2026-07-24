import {
    reduceOverlay,
    type OverlayIntent,
    type OverlaySnapshot,
} from '../shared/overlay-state';

export const INITIAL_OVERLAY_SNAPSHOT: OverlaySnapshot = {
    target: 'closed',
    phase: 'hidden',
    revision: 0,
};

export function applyOverlayIntent(snapshot: OverlaySnapshot, intent: OverlayIntent): OverlaySnapshot {
    return reduceOverlay(snapshot, intent);
}

export function isCurrentOverlayRevision(snapshot: OverlaySnapshot, revision: number): boolean {
    return snapshot.revision === revision;
}
