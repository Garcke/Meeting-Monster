export const IPC_CHANNELS = {
    window: {
        getState: 'window:get-state',
        setExpanded: 'window:set-expanded',
        toggleExpanded: 'window:toggle-expanded',
        hide: 'window:hide',
        quit: 'window:quit',
        show: 'window:show',
        state: 'window:state',
    },
    privacy: {
        getStatus: 'privacy:get-status',
        getPolicy: 'privacy:get-policy',
        setCaptureProtection: 'privacy:set-capture-protection',
        status: 'privacy:status',
    },
    models: {list: 'models:list', getSaved: 'models:get-saved', save: 'models:save', test: 'models:test'},
    chat: {send: 'chat:send', cancel: 'chat:cancel', event: 'chat:event'},
    asrModels: {
        list: 'asr-models:list',
        select: 'asr-models:select',
        download: 'asr-models:download',
        cancel: 'asr-models:cancel',
        delete: 'asr-models:delete',
        status: 'asr-models:status',
    },
    asr: {
        start: 'asr:start',
        stop: 'asr:stop',
        getStatus: 'asr:get-status',
        status: 'asr:status',
        result: 'asr:result',
        port: 'asr:port',
    },
    overlay: {
        intent: 'overlay:intent',
        getSnapshot: 'overlay:get-snapshot',
        snapshot: 'overlay:snapshot',
        rendererReady: 'overlay:renderer-ready',
        animationFinished: 'overlay:animation-finished',
        windowError: 'overlay:window-error',
    },
} as const;

type ValueOf<T> = T[keyof T];

export type IpcChannel = ValueOf<ValueOf<typeof IPC_CHANNELS>>;
export type WindowMode = 'capsule' | 'expanded';
export type CaptureProtection = 'protected' | 'disabled' | 'failed' | 'unsupported';
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

export type AsrModelId =
    | 'streaming-paraformer-bilingual-zh-en'
    | 'streaming-zipformer-zh-int8-2025-06-30';
export type AsrModelState =
    | 'not-downloaded' | 'downloading' | 'verifying' | 'installed'
    | 'loading' | 'ready' | 'failed';

export interface AsrModelView {
    id: AsrModelId;
    label: string;
    languages: string[];
    description: string;
    estimatedBytes: number;
    supportsHotwords: boolean;
    installedState: AsrModelState;
    isCurrent: boolean;
    downloadedBytes: number;
    totalBytes: number;
    errorMessage?: string;
}

export interface AsrModelSnapshot {
    currentModelId: AsrModelId;
    models: AsrModelView[];
}

export type ModelProfileId = 'generic_openai' | 'generic_anthropic';
export type ModelProtocol = 'openai' | 'anthropic';

export interface WindowState {
    mode: WindowMode;
    visible: boolean;
}

export interface PrivacyStatus {
    captureProtection: CaptureProtection;
    captureProtectionEnabled: boolean;
    platform: NodeJS.Platform;
    windowCount: number;
}

export interface PrivacyPolicy {
    captureProtectionDefault: true;
    supportedPlatforms: readonly ['win32', 'darwin'];
    captureProtectionShortcut: 'CommandOrControl+Shift+P';
    taskbarHidden: false;
}

export interface SelectableModelProfile {
    id: string;
    label: string;
    protocol: ModelProtocol;
    model: string;
    api_key_required: boolean;
    has_api_key: boolean;
    max_tokens: number;
    temperature: number | null;
    active: boolean;
}

export interface ModelOptions {
    active_profile: string;
    profiles: SelectableModelProfile[];
}

export interface ModelSelectionInput {
    profile_id: ModelProfileId;
    protocol: ModelProtocol;
    base_url: string;
    model: string;
    api_key?: string;
    max_tokens?: number;
    temperature?: number | null;
}

export interface ModelConnectionInput extends ModelSelectionInput {
}

export interface SavedModelConnection {
    profile_id: ModelProfileId;
    protocol: ModelProtocol;
    base_url: string;
    model: string;
    has_api_key: boolean;
    max_tokens: number;
    temperature?: number | null;
}

export interface SavedModelConnectionSettings {
    active_profile: ModelProfileId;
    connections: Partial<Record<ModelProfileId, SavedModelConnection>>;
}

export interface ModelTestResult {
    ok: boolean;
    latency_ms: number;
    model: string;
}

export interface ChatStreamEvent {
    requestId: string;
    type: 'chunk' | 'done' | 'error';
    text?: string;
}

export type AsrState = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error';

export interface AsrStatus {
    state: AsrState;
    message?: string;
}

export interface AsrResultEvent {
    type: 'partial' | 'final' | 'error';
    text: string;
}

export type Unsubscribe = () => void;

export interface MeetingMonsterApi {
    window: {
        getState(): Promise<WindowState>;
        setExpanded(expanded: boolean): Promise<WindowState>;
        toggleExpanded(): Promise<WindowState>;
        hide(): Promise<WindowState>;
        quit(): Promise<void>;
        show(): Promise<WindowState>;
        onState(callback: (state: WindowState) => void): Unsubscribe;
    };
    overlay: {
        intent(intent: OverlayIntent): Promise<OverlaySnapshot>;
        getSnapshot(): Promise<OverlaySnapshot>;
        rendererReady(revision: number): Promise<OverlaySnapshot>;
        /** Compatibility alias for older renderer code during migration. */
        panelReady(revision: number): Promise<OverlaySnapshot>;
        animationFinished(revision: number): Promise<OverlaySnapshot>;
        onSnapshot(callback: (snapshot: OverlaySnapshot) => void): Unsubscribe;
        onWindowError(callback: (error: string) => void): Unsubscribe;
    };
    privacy: {
        getStatus(): Promise<PrivacyStatus>;
        getPolicy(): Promise<PrivacyPolicy>;
        setCaptureProtection(enabled: boolean): Promise<PrivacyStatus>;
        onStatus(callback: (status: PrivacyStatus) => void): Unsubscribe;
    };
    models: {
        list(): Promise<ModelOptions>;
        getSaved(): Promise<SavedModelConnectionSettings>;
        save(connection: ModelConnectionInput): Promise<SavedModelConnectionSettings>;
        test(selection: ModelSelectionInput): Promise<ModelTestResult>;
    };
    chat: {
        send(requestId: string, content: string, selection?: ModelSelectionInput): Promise<{requestId: string}>;
        cancel(requestId: string): Promise<{cancelled: boolean}>;
        onEvent(callback: (event: ChatStreamEvent) => void): Unsubscribe;
    };
    asrModels: {
        list(): Promise<AsrModelSnapshot>;
        select(modelId: AsrModelId): Promise<AsrModelSnapshot>;
        download(modelId: AsrModelId): Promise<AsrModelSnapshot>;
        cancel(modelId: AsrModelId): Promise<{cancelled: boolean}>;
        delete(modelId: AsrModelId): Promise<AsrModelSnapshot>;
        onStatus(callback: (snapshot: AsrModelSnapshot) => void): Unsubscribe;
    };
    asr: {
        start(sampleRate: number): Promise<AsrStatus>;
        writePcm(chunk: Int16Array): void;
        stop(): Promise<AsrStatus>;
        getStatus(): Promise<AsrStatus>;
        onStatus(callback: (status: AsrStatus) => void): Unsubscribe;
        onResult(callback: (event: AsrResultEvent) => void): Unsubscribe;
    };
}
