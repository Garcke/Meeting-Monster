import type {BackendModelSelection, BackendProvider} from '../types';

export class ProviderCache {
    private readonly providers = new Map<string, BackendProvider>();
    private readonly evictionDisposals = new Set<Promise<void>>();
    private disposed = false;

    constructor(
        private readonly factory: (selection: BackendModelSelection) => BackendProvider,
        private readonly maxEntries = 8,
    ) {
        if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new RangeError('maxEntries must be positive');
    }

    get(selection: BackendModelSelection): BackendProvider {
        if (this.disposed) throw new Error('ProviderCache is disposed');
        const key = selectionKey(selection);
        const existing = this.providers.get(key);
        if (existing) {
            this.providers.delete(key);
            this.providers.set(key, existing);
            return existing;
        }
        const provider = this.factory(selection);
        this.providers.set(key, provider);
        if (this.providers.size > this.maxEntries) {
            const oldest = this.providers.entries().next().value as [string, BackendProvider];
            this.providers.delete(oldest[0]);
            this.disposeEvicted(oldest[1]);
        }
        return provider;
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        const providers = [...this.providers.values()];
        this.providers.clear();
        const results = await Promise.allSettled([
            ...providers.map((provider) => provider.dispose()),
            ...this.evictionDisposals,
        ]);
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) throw failure.reason;
    }

    private disposeEvicted(provider: BackendProvider): void {
        const task = provider.dispose().catch(() => undefined).finally(() => {
            this.evictionDisposals.delete(task);
        });
        this.evictionDisposals.add(task);
    }
}

function selectionKey(selection: BackendModelSelection): string {
    return JSON.stringify([selection.protocol, selection.base_url, selection.model, selection.api_key,
        selection.max_tokens, selection.temperature]);
}
