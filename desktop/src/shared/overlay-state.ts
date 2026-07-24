export type OverlayTarget = 'closed' | 'workspace' | 'settings';
export type OverlayPhase = 'hidden' | 'opening' | 'visible' | 'closing';

export interface OverlaySnapshot {
    target: OverlayTarget;
    phase: OverlayPhase;
    revision: number;
}

export type OverlayIntent =
    | {type: 'toggle-workspace'}
    | {type: 'toggle-settings'};

export function reduceOverlay(snapshot: OverlaySnapshot, intent: OverlayIntent): OverlaySnapshot {
    const target = intent.type === 'toggle-workspace'
        ? snapshot.target === 'workspace' ? 'closed' : 'workspace'
        : snapshot.target === 'settings' ? 'closed' : 'settings';

    return {
        target,
        phase: target === 'closed' ? 'closing' : 'opening',
        revision: snapshot.revision + 1,
    };
}

export function isCurrentRevision(snapshot: OverlaySnapshot, revision: number): boolean {
    return snapshot.revision === revision;
}
