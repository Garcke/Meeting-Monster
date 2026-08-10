import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {BackendService} from '../../../desktop/src/backend/backend-service';
import type {BackendImage, BackendModelSelection, BackendProvider, ChatMessage} from '../../../desktop/src/backend/types';
import {ModelConnectionStore} from '../../../desktop/src/main/model-connection-settings';
import type {ModelTestProgress} from '../../../desktop/src/shared/contracts';

const selection: BackendModelSelection = {
    profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://provider.example/v1',
    model: 'vision-model', api_key: 'saved-secret', max_tokens: 512, temperature: 0.6,
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

async function createStore(saved?: BackendModelSelection): Promise<ModelConnectionStore> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'meeting-monster-backend-service-'));
    temporaryDirectories.push(directory);
    const store = new ModelConnectionStore({
        settingsPath: path.join(directory, 'models.json'),
        safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (plaintext) => Buffer.from(plaintext, 'utf8'),
            decryptString: (ciphertext) => ciphertext.toString('utf8'),
        },
    });
    if (saved) await store.saveVerifiedConnection(saved);
    return store;
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
    const events: unknown[] = [];
    for await (const event of stream) events.push(event);
    return events;
}

class FakeProvider implements BackendProvider {
    disposeCount = 0;

    constructor(
        readonly key: string,
        private readonly stream: (messages: readonly ChatMessage[], signal: AbortSignal) => AsyncGenerator<string>,
    ) {}

    streamText(messages: readonly ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
        return this.stream(messages, signal);
    }

    async dispose(): Promise<void> { this.disposeCount += 1; }
}

async function* chunks(...values: string[]): AsyncGenerator<string> {
    yield* values;
}

async function* untilAbort(signal: AbortSignal): AsyncGenerator<string> {
    yield 'started';
    if (!signal.aborted) {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), {once: true}));
    }
}

describe('BackendService model options and selection resolution', () => {
    it('lists fixed protocol options hydrated from saved settings without making a network request', async () => {
        const store = await createStore(selection);
        const fetcher = vi.fn(async () => new Response(null, {status: 500}));
        const service = new BackendService({connectionStore: store, fetcher});

        await expect(service.listModelOptions()).resolves.toEqual({
            active_profile: 'generic_openai',
            profiles: [
                {id: 'generic_openai', label: 'OpenAI Compatible', protocol: 'openai', model: 'vision-model', api_key_required: false, has_api_key: true, max_tokens: 512, temperature: 0.6, active: true},
                {id: 'generic_anthropic', label: 'Anthropic Compatible', protocol: 'anthropic', model: '', api_key_required: false, has_api_key: false, max_tokens: 4096, temperature: 0.3, active: false},
            ],
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('preserves an explicitly saved null temperature in model options', async () => {
        const store = await createStore({...selection, temperature: null});
        const service = new BackendService({connectionStore: store});

        const options = await service.listModelOptions();
        expect(options.profiles[0].temperature).toBeNull();
    });

    it('inherits a saved API key when every connection identity field matches', async () => {
        const store = await createStore(selection);
        const created: BackendModelSelection[] = [];
        const service = new BackendService({
            connectionStore: store,
            providerFactory: (requested) => {
                created.push(requested);
                return new FakeProvider('provider', () => chunks('answer'));
            },
        });

        await collect(service.streamChat('same', 'Question', {...selection, api_key: undefined}));
        expect(created[0].api_key).toBe('saved-secret');
    });

    it('does not inherit a saved API key when the requested model identity differs', async () => {
        const store = await createStore(selection);
        const created: BackendModelSelection[] = [];
        const service = new BackendService({
            connectionStore: store,
            providerFactory: (requested) => {
                created.push(requested);
                return new FakeProvider('provider', () => chunks('answer'));
            },
        });

        await collect(service.streamChat('different', 'Question', {...selection, model: 'other-model', api_key: undefined}));
        expect(created[0].api_key).toBeUndefined();
    });

    it('uses the active saved connection when a chat selection is omitted', async () => {
        const store = await createStore(selection);
        const created: BackendModelSelection[] = [];
        const service = new BackendService({
            connectionStore: store,
            providerFactory: (requested) => {
                created.push(requested);
                return new FakeProvider('provider', () => chunks('answer'));
            },
        });

        await collect(service.streamChat('saved', 'Question'));
        expect(created).toEqual([selection]);
    });

    it('rejects missing active configuration before creating a provider', async () => {
        const providerFactory = vi.fn(() => new FakeProvider('unused', () => chunks()));
        const service = new BackendService({connectionStore: await createStore(), providerFactory});

        await expect(collect(service.streamChat('missing', 'Question'))).rejects.toThrow(/configuration/i);
        expect(providerFactory).not.toHaveBeenCalled();
    });

    it('rejects malformed PNG input before selection or provider creation', async () => {
        const providerFactory = vi.fn(() => new FakeProvider('unused', () => chunks()));
        const fetcher = vi.fn(async () => new Response(null, {status: 500}));
        const service = new BackendService({
            connectionStore: await createStore(selection),
            providerFactory,
            fetcher,
        });
        const invalidImage: BackendImage = {
            media_type: 'image/png',
            data: Buffer.from('not a PNG', 'utf8').toString('base64'),
        };

        await expect(collect(service.streamChat('invalid-image', 'Question', selection, invalidImage)))
            .rejects.toThrow(/png|image/i);
        expect(providerFactory).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
    });
});

describe('BackendService request lifecycle', () => {
    it('rejects duplicate active IDs, cancels by ID, and releases the ID in finally', async () => {
        const provider = new FakeProvider('blocking', (_messages, signal) => untilAbort(signal));
        const service = new BackendService({
            connectionStore: await createStore(selection),
            providerFactory: () => provider,
        });
        const first = service.streamChat('request-1', 'Question')[Symbol.asyncIterator]();

        await expect(first.next()).resolves.toEqual({done: false, value: {type: 'chunk', text: 'started'}});
        await expect(collect(service.streamChat('request-1', 'Duplicate'))).rejects.toThrow(/already active/i);
        expect(service.cancel('request-1')).toBe(true);
        await expect(first.next()).resolves.toEqual({done: true, value: undefined});
        expect(service.cancel('request-1')).toBe(false);

        const reused = service.streamChat('request-1', 'Reused')[Symbol.asyncIterator]();
        await expect(reused.next()).resolves.toEqual({done: false, value: {type: 'chunk', text: 'started'}});
        expect(service.cancel('request-1')).toBe(true);
        await reused.next();
    });

    it('reports connecting then vision and tests a short zero-temperature selection', async () => {
        const created: BackendModelSelection[] = [];
        const progress: ModelTestProgress[] = [];
        const verifier = vi.fn(async () => true);
        const service = new BackendService({
            connectionStore: await createStore(selection),
            providerFactory: (requested) => {
                created.push(requested);
                return new FakeProvider('vision', () => chunks());
            },
            visionVerifier: verifier,
        });

        await expect(service.testModel({...selection, api_key: undefined}, (item) => progress.push(item))).resolves.toMatchObject({
            ok: true, vision: true, model: 'vision-model', latency_ms: expect.any(Number),
        });
        expect(progress).toEqual([
            {phase: 'connecting', attempt: 0, maxAttempts: 3},
            {phase: 'vision', attempt: 1, maxAttempts: 3},
        ]);
        expect(created).toEqual([{...selection, max_tokens: 32, temperature: 0}]);
        expect(verifier).toHaveBeenCalledOnce();
    });

    it('retries a false vision result and succeeds on the next challenge', async () => {
        const progress: ModelTestProgress[] = [];
        let attempt = 0;
        const service = new BackendService({
            connectionStore: await createStore(selection),
            providerFactory: () => new FakeProvider('vision', () => chunks()),
            visionVerifier: async () => {
                attempt += 1;
                return attempt === 2;
            },
        });

        await expect(service.testModel(selection, (item) => progress.push(item))).resolves.toMatchObject({ok: true});
        expect(progress).toEqual([
            {phase: 'connecting', attempt: 0, maxAttempts: 3},
            {phase: 'vision', attempt: 1, maxAttempts: 3},
            {phase: 'vision', attempt: 2, maxAttempts: 3},
        ]);
    });

    it('classifies three failed vision challenges without exposing credentials', async () => {
        const progress: ModelTestProgress[] = [];
        const verifier = vi.fn(async () => false);
        const service = new BackendService({
            connectionStore: await createStore(selection),
            providerFactory: () => new FakeProvider('vision', () => chunks()),
            visionVerifier: verifier,
        });

        const error = await service.testModel(selection, (item) => progress.push(item)).catch((failure: unknown) => failure);
        expect(error).toMatchObject({code: 'vision_verification_failed'});
        expect(String(error)).not.toContain('saved-secret');
        expect(progress).toEqual([
            {phase: 'connecting', attempt: 0, maxAttempts: 3},
            {phase: 'vision', attempt: 1, maxAttempts: 3},
            {phase: 'vision', attempt: 2, maxAttempts: 3},
            {phase: 'vision', attempt: 3, maxAttempts: 3},
        ]);
        expect(verifier).toHaveBeenCalledTimes(3);
    });

    it('does not retry a provider failure during vision verification', async () => {
        const verifier = vi.fn(async () => {
            throw Object.assign(new Error('provider body with saved-secret'), {status: 401});
        });
        const service = new BackendService({
            connectionStore: await createStore(selection),
            providerFactory: () => new FakeProvider('vision', () => chunks()),
            visionVerifier: verifier,
        });

        const error = await service.testModel(selection).catch((failure: unknown) => failure);
        expect(error).toMatchObject({code: 'authentication_failed', providerStatus: 401});
        expect(String(error)).not.toContain('saved-secret');
        expect(verifier).toHaveBeenCalledOnce();
    });

    it('sanitizes an external error that spoofs the internal model-test error name', async () => {
        const leaked = 'saved-secret https://provider.example/v1 vision-model iVBORw0KGgo=';
        const service = new BackendService({
            connectionStore: await createStore(selection),
            providerFactory: () => new FakeProvider('vision', () => chunks()),
            visionVerifier: async () => {
                throw Object.assign(new Error(leaked), {
                    name: 'BackendModelTestError',
                    code: 'vision_verification_failed',
                    status: 401,
                });
            },
        });

        const error = await service.testModel(selection).catch((failure: unknown) => failure);
        expect(error).toMatchObject({code: 'authentication_failed', providerStatus: 401});
        expect(String(error)).not.toContain('saved-secret');
        expect(String(error)).not.toContain('provider.example');
        expect(String(error)).not.toContain('vision-model');
        expect(String(error)).not.toContain('iVBORw0KGgo');
    });

    it('does not expose a provider failure that races with disposal', async () => {
        let verificationStarted!: () => void;
        const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
        const service = new BackendService({
            connectionStore: await createStore(selection),
            providerFactory: () => new FakeProvider('vision', () => chunks()),
            visionVerifier: async (_provider, _challenge, signal) => {
                verificationStarted();
                return new Promise<boolean>((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(new Error('provider body with saved-secret')), {once: true});
                });
            },
        });
        const pending = service.testModel(selection);
        await started;

        await service.dispose();
        const error = await pending.catch((failure: unknown) => failure);
        expect(String(error)).toMatch(/disposed/i);
        expect(String(error)).not.toContain('saved-secret');
    });

    it('disposes once, aborts active work, and rejects every new operation before network access', async () => {
        const provider = new FakeProvider('active', (_messages, signal) => untilAbort(signal));
        const providerFactory = vi.fn(() => provider);
        const fetcher = vi.fn(async () => new Response(null, {status: 500}));
        const service = new BackendService({
            connectionStore: await createStore(selection), providerFactory, fetcher,
        });
        const active = service.streamChat('active', 'Question')[Symbol.asyncIterator]();
        await active.next();

        await service.dispose();
        await service.dispose();
        await expect(active.next()).resolves.toEqual({done: true, value: undefined});
        expect(provider.disposeCount).toBe(1);
        expect(service.cancel('active')).toBe(false);

        await expect(service.listModelOptions()).rejects.toThrow(/disposed/i);
        await expect(collect(service.streamChat('late', 'Question', selection))).rejects.toThrow(/disposed/i);
        await expect(service.testModel(selection)).rejects.toThrow(/disposed/i);
        expect(providerFactory).toHaveBeenCalledOnce();
        expect(fetcher).not.toHaveBeenCalled();
    });
});
