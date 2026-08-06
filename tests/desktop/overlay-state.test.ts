import {describe, expect, it} from 'vitest';
import {reduceOverlay, isCurrentRevision, type OverlaySnapshot} from '../../desktop/ui/shared/state/overlay-state';

const closed: OverlaySnapshot = {target: 'closed', phase: 'hidden', revision: 0};

describe('overlay reducer', () => {
  it.each([
    ['closed', 'workspace'],
    ['workspace', 'closed'],
  ] as const)('%s toggles to %s', (target, expected) => {
    const result = reduceOverlay(
      {target, phase: target === 'closed' ? 'hidden' : 'visible', revision: 4},
      {type: 'toggle-workspace'},
    );
    expect(result.target).toBe(expected);
    expect(result.revision).toBe(5);
  });

  it('rejects stale revisions', () => {
    const current = reduceOverlay(closed, {type: 'toggle-workspace'});
    expect(isCurrentRevision(current, current.revision)).toBe(true);
    expect(isCurrentRevision(current, current.revision - 1)).toBe(false);
  });
});
