export type OverlayTarget = 'closed' | 'workspace';
export type OverlayPhase = 'hidden' | 'opening' | 'visible' | 'closing';

export interface OverlaySnapshot {
    target: OverlayTarget;
    phase: OverlayPhase;
    revision: number;
}

export type OverlayIntent = {type: 'toggle-workspace'};

export function reduceOverlay(snapshot: OverlaySnapshot, _intent: OverlayIntent): OverlaySnapshot {
    const target: OverlayTarget = snapshot.target === 'workspace' ? 'closed' : 'workspace';

    return {
        target,
        phase: target === 'closed' ? 'closing' : 'opening',
        revision: snapshot.revision + 1,
    };
}

export function isCurrentRevision(snapshot: OverlaySnapshot, revision: number): boolean {
    return snapshot.revision === revision;
}
