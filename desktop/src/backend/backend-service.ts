import type {
    ModelDiagnosticCode,
    ModelOptions,
    ModelTestProgress,
    ModelTestResult,
    SelectableModelProfile,
} from '../shared/contracts';
import {MAX_MODEL_TEST_ATTEMPTS} from '../shared/contracts';
import {formatModelConnectionError} from '../shared/model-connection-diagnostics';
import {
    mergeModelConnectionWithSaved,
    type ModelConnection,
    type ModelConnectionCandidate,
    type ModelConnectionStore,
} from '../main/model-connection-settings';
import {parseBackendImage} from './chat-images';
import {ChatService} from './chat-service';
import {classifyProviderError} from './model-diagnostics';
import {createAnthropicProvider} from './providers/anthropic-provider';
import {createOpenAiProvider} from './providers/openai-provider';
import type {BackendFetch} from './providers/provider';
import {ProviderCache} from './providers/provider-cache';
import type {BackendChatEvent, BackendImage, BackendModelSelection, BackendProvider} from './types';
import {validateBackendSelection} from './validation';
import {createVisionChallenge, verifyProviderVision, type VisionChallenge} from './vision-challenge';

const MODEL_TEST_MAX_TOKENS = 32;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.3;

export interface BackendServiceOptions {
    connectionStore: ModelConnectionStore;
    fetcher?: BackendFetch;
    providerFactory?: (selection: BackendModelSelection, fetcher: BackendFetch) => BackendProvider;
    visionVerifier?: (provider: BackendProvider, challenge: VisionChallenge, signal: AbortSignal) => Promise<boolean>;
}

/** Owns native model providers, conversation state, and request cancellation for Electron main. */
export class BackendService {
    private readonly providers: ProviderCache;
    private readonly chat: ChatService;
    private readonly requests = new Map<string, AbortController>();
    private readonly modelTests = new Set<AbortController>();
    private readonly visionVerifier: NonNullable<BackendServiceOptions['visionVerifier']>;
    private disposed = false;
    private disposal?: Promise<void>;

    constructor(private readonly options: BackendServiceOptions) {
        const fetcher = options.fetcher ?? fetch;
        const factory = options.providerFactory ?? createProvider;
        this.providers = new ProviderCache((selection) => factory(selection, fetcher));
        this.chat = new ChatService({providers: this.providers});
        this.visionVerifier = options.visionVerifier ?? verifyProviderVision;
    }

    async listModelOptions(): Promise<ModelOptions> {
        this.assertActive();
        const saved = await this.options.connectionStore.loadSummary();
        this.assertActive();
        return {
            active_profile: saved.active_profile,
            profiles: [
                modelOption('generic_openai', 'openai', 'OpenAI Compatible', saved),
                modelOption('generic_anthropic', 'anthropic', 'Anthropic Compatible', saved),
            ],
        };
    }

    async *streamChat(
        requestId: string,
        content: string,
        selection?: BackendModelSelection,
        image?: BackendImage,
    ): AsyncGenerator<BackendChatEvent> {
        this.assertActive();
        if (this.requests.has(requestId)) throw new Error(`Backend request is already active: ${requestId}`);
        const controller = new AbortController();
        this.requests.set(requestId, controller);
        try {
            const validatedImage = image === undefined ? undefined : parseBackendImage(image);
            const resolved = await this.resolveSelection(selection);
            this.assertActive();
            yield* this.chat.stream(content, resolved, controller.signal, validatedImage);
        } finally {
            if (this.requests.get(requestId) === controller) this.requests.delete(requestId);
        }
    }

    async testModel(
        selection: BackendModelSelection,
        onProgress: (progress: ModelTestProgress) => void = () => undefined,
    ): Promise<ModelTestResult> {
        this.assertActive();
        const controller = new AbortController();
        this.modelTests.add(controller);
        const started = Date.now();
        try {
            onProgress({phase: 'connecting', attempt: 0, maxAttempts: MAX_MODEL_TEST_ATTEMPTS});
            const resolved = await this.resolveSelection(selection);
            this.assertActive();
            abortIfNeeded(controller.signal);
            const shortSelection = {...resolved, max_tokens: MODEL_TEST_MAX_TOKENS, temperature: 0};
            const provider = this.providers.get(shortSelection);
            for (let attempt = 1; attempt <= MAX_MODEL_TEST_ATTEMPTS; attempt += 1) {
                onProgress({phase: 'vision', attempt, maxAttempts: MAX_MODEL_TEST_ATTEMPTS});
                const supportsVision = await this.visionVerifier(
                    provider,
                    createVisionChallenge(),
                    controller.signal,
                );
                abortIfNeeded(controller.signal);
                if (supportsVision) {
                    return {
                        ok: true,
                        vision: true,
                        latency_ms: Math.max(0, Date.now() - started),
                        model: shortSelection.model,
                    };
                }
            }
            throw modelTestError('vision_verification_failed');
        } catch (error) {
            if (isModelTestError(error)) throw error;
            abortIfNeeded(controller.signal);
            const diagnostic = classifyProviderError(error);
            throw modelTestError(diagnosticCode(diagnostic.kind), diagnostic.status);
        } finally {
            this.modelTests.delete(controller);
        }
    }

    resetConversation(): void {
        this.assertActive();
        this.chat.reset();
    }

    cancel(requestId: string): boolean {
        const controller = this.requests.get(requestId);
        if (!controller) return false;
        controller.abort(new Error('Backend request cancelled'));
        return true;
    }

    dispose(): Promise<void> {
        if (this.disposal) return this.disposal;
        this.disposed = true;
        for (const controller of this.requests.values()) controller.abort(new Error('BackendService is disposed'));
        this.requests.clear();
        for (const controller of this.modelTests) controller.abort(new Error('BackendService is disposed'));
        this.modelTests.clear();
        this.disposal = this.chat.dispose();
        return this.disposal;
    }

    private async resolveSelection(selection?: BackendModelSelection): Promise<BackendModelSelection> {
        const settings = await this.options.connectionStore.loadSettings();
        if (!selection) {
            const active = settings?.connections[settings.active_profile];
            if (!active) throw new Error('Model connection configuration is required');
            return connectionSelection(active);
        }

        const requested = validateBackendSelection(selection);
        const saved = settings?.connections[requested.profile_id];
        return connectionSelection(mergeModelConnectionWithSaved(requested, saved));
    }

    private assertActive(): void {
        if (this.disposed) throw new Error('BackendService is disposed');
    }
}

function createProvider(selection: BackendModelSelection, fetcher: BackendFetch): BackendProvider {
    return selection.protocol === 'openai'
        ? createOpenAiProvider(selection, fetcher)
        : createAnthropicProvider(selection, fetcher);
}

function connectionSelection(connection: ModelConnection | ModelConnectionCandidate): BackendModelSelection {
    return {
        profile_id: connection.profile_id,
        protocol: connection.protocol,
        base_url: connection.base_url,
        model: connection.model,
        ...(connection.api_key ? {api_key: connection.api_key} : {}),
        max_tokens: connection.max_tokens,
        ...(connection.temperature === undefined ? {} : {temperature: connection.temperature}),
    };
}

function modelOption(
    id: 'generic_openai' | 'generic_anthropic',
    protocol: 'openai' | 'anthropic',
    label: string,
    saved: Awaited<ReturnType<ModelConnectionStore['loadSummary']>>,
): SelectableModelProfile {
    const connection = saved.connections[id];
    return {
        id,
        label,
        protocol,
        model: connection?.model ?? '',
        api_key_required: false,
        has_api_key: connection?.has_api_key ?? false,
        max_tokens: connection?.max_tokens ?? DEFAULT_MAX_TOKENS,
        temperature: connection?.temperature === undefined ? DEFAULT_TEMPERATURE : connection.temperature,
        active: saved.active_profile === id,
    };
}

function diagnosticCode(kind: ReturnType<typeof classifyProviderError>['kind']): ModelDiagnosticCode {
    const codes: Record<ReturnType<typeof classifyProviderError>['kind'], ModelDiagnosticCode> = {
        authentication: 'authentication_failed',
        not_found: 'model_not_found',
        invalid_request: 'invalid_request',
        rate_limited: 'rate_limited',
        timeout: 'timeout',
        unreachable: 'unreachable',
        upstream: 'upstream_error',
        unknown: 'unknown',
    };
    return codes[kind];
}

class InternalModelTestError extends Error {
    readonly name = 'BackendModelTestError';

    constructor(
        readonly code: ModelDiagnosticCode,
        message: string,
        readonly providerStatus?: number,
    ) {
        super(message);
    }
}

function modelTestError(code: ModelDiagnosticCode, providerStatus?: number): Error {
    return new InternalModelTestError(
        code,
        formatModelConnectionError({code, providerStatus}),
        providerStatus,
    );
}

function isModelTestError(error: unknown): boolean {
    return error instanceof InternalModelTestError;
}

function abortIfNeeded(signal: AbortSignal): void {
    if (signal.aborted) throw signal.reason ?? new Error('Backend request cancelled');
}
