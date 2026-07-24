import type {WindowBounds} from './window-geometry';

export type BoundsMoveKind = 'programmatic' | 'user';

interface PendingBounds {
    bounds: WindowBounds;
    expiresAt: number;
}

function boundsEqual(left: WindowBounds, right: WindowBounds): boolean {
    return left.x === right.x
        && left.y === right.y
        && left.width === right.width
        && left.height === right.height;
}

export class ProgrammaticBoundsTracker {
    private readonly ttlMs: number;
    private pending: PendingBounds[] = [];

    constructor(options: {ttlMs?: number} = {}) {
        this.ttlMs = options.ttlMs ?? 250;
    }

    mark(bounds: WindowBounds, now = Date.now()): void {
        this.expire(now);
        this.pending.push({bounds: {...bounds}, expiresAt: now + this.ttlMs});
    }

    consume(bounds: WindowBounds, now = Date.now()): BoundsMoveKind {
        this.expire(now);
        const matchedIndex = this.pending.findIndex((item) => boundsEqual(item.bounds, bounds));
        if (matchedIndex >= 0) {
            this.pending.splice(0, matchedIndex + 1);
            return 'programmatic';
        }
        if (this.pending.length > 0) return 'programmatic';
        return 'user';
    }

    private expire(now: number): void {
        this.pending = this.pending.filter((item) => item.expiresAt > now);
    }
}
