import {describe, expect, it} from 'vitest';
import {
    createBackendLifecycle,
    sanitizeBackendLifecycleError,
} from '../../../desktop/src/main/backend-lifecycle';

describe('Electron backend lifecycle', () => {
    it('disposes the backend once before the application exits', async () => {
        const calls: string[] = [];
        const lifecycle = createBackendLifecycle({
            dispose: async () => { calls.push('dispose'); },
        });

        await lifecycle.disposeForQuit();
        await lifecycle.disposeForQuit();

        expect(calls).toEqual(['dispose']);
    });

    it('rejects new backend work as soon as quit disposal starts', async () => {
        let finishDisposal: (() => void) | undefined;
        const backend = {
            dispose: () => new Promise<void>((resolve) => { finishDisposal = resolve; }),
        };
        const lifecycle = createBackendLifecycle(backend);

        expect(lifecycle.getBackend()).toBe(backend);
        const disposal = lifecycle.disposeForQuit();

        expect(() => lifecycle.getBackend()).toThrow(/shutting down/i);
        finishDisposal?.();
        await disposal;
    });

    it('shares one disposal result between concurrent quit requests', async () => {
        let finishDisposal: (() => void) | undefined;
        let disposeCalls = 0;
        const lifecycle = createBackendLifecycle({
            dispose: () => {
                disposeCalls += 1;
                return new Promise<void>((resolve) => { finishDisposal = resolve; });
            },
        });

        const firstQuit = lifecycle.disposeForQuit();
        const secondQuit = lifecycle.disposeForQuit();

        expect(secondQuit).toBe(firstQuit);
        expect(disposeCalls).toBe(1);
        finishDisposal?.();
        await expect(Promise.all([firstQuit, secondQuit])).resolves.toEqual([undefined, undefined]);
    });

    it('sanitizes backend disposal failures before they can be logged', () => {
        const error = sanitizeBackendLifecycleError(new Error('provider-secret disposal failed'));

        expect(error.message).toBe('Native backend shutdown failed');
        expect(error.message).not.toContain('provider-secret');
    });
});
