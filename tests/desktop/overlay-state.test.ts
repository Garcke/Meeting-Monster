import {describe, expect, it} from 'vitest';
import {reduceOverlay, isCurrentRevision, type OverlaySnapshot} from '../../desktop/ui/shared/state/overlay-state';

const closed: OverlaySnapshot = {target: 'closed', phase: 'hidden', revision: 0};

describe('overlay reducer', () => {
  it('keeps settings independent from workspace', () => {
    const settings = reduceOverlay(closed, {type: 'toggle-settings'});
    expect(settings.target).toBe('settings');
    expect(reduceOverlay(settings, {type: 'toggle-settings'}).target).toBe('closed');
    expect(reduceOverlay(settings, {type: 'toggle-workspace'}).target).toBe('workspace');
  });

  it.each([
    ['closed', 'toggle-workspace', 'workspace'],
    ['workspace', 'toggle-workspace', 'closed'],
    ['closed', 'toggle-settings', 'settings'],
    ['settings', 'toggle-settings', 'closed'],
    ['workspace', 'toggle-settings', 'settings'],
    ['settings', 'toggle-workspace', 'workspace'],
  ] as const)('%s + %s -> %s', (target, type, expected) => {
    const result = reduceOverlay({target, phase: target === 'closed' ? 'hidden' : 'visible', revision: 4}, {type});
    expect(result.target).toBe(expected);
    expect(result.revision).toBe(5);
  });

  it('rejects stale revisions', () => {
    const current = reduceOverlay(closed, {type: 'toggle-workspace'});
    expect(isCurrentRevision(current, current.revision)).toBe(true);
    expect(isCurrentRevision(current, current.revision - 1)).toBe(false);
  });
});
