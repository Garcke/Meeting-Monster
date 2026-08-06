const {contextBridge} = require('electron');

const audioInputListeners = new Set();
const modelProgressListeners = new Set();
const asrStatusListeners = new Set();

const savedModels = {
    active_profile: 'generic_openai',
    connections: {
        generic_openai: {
            profile_id: 'generic_openai',
            protocol: 'openai',
            base_url: 'https://provider.example/v1',
            model: 'test-model',
            has_api_key: false,
            max_tokens: 2048,
            temperature: 0.3,
            vision_verified: true,
        },
    },
};

const modelOptions = {
    active_profile: 'generic_openai',
    profiles: [
        {id: 'generic_openai', label: 'OpenAI Compatible', protocol: 'openai', model: 'test-model', api_key_required: false, has_api_key: false, max_tokens: 2048, temperature: 0.3, active: true},
        {id: 'generic_anthropic', label: 'Anthropic Compatible', protocol: 'anthropic', model: 'test-model', api_key_required: false, has_api_key: false, max_tokens: 2048, temperature: 0.3, active: false},
    ],
};

const asrSnapshot = {
    currentModelId: 'streaming-paraformer-bilingual-zh-en',
    models: [
        {id: 'streaming-paraformer-bilingual-zh-en', label: 'Streaming Paraformer (Chinese + English)', languages: ['zh', 'en'], description: 'Paraformer', estimatedBytes: 226000000, supportsHotwords: false, installedState: 'installed', isCurrent: true, downloadedBytes: 226000000, totalBytes: 226000000},
        {id: 'streaming-zipformer-zh-int8-2025-06-30', label: 'Streaming Zipformer (Chinese)', languages: ['zh'], description: 'Zipformer', estimatedBytes: 180000000, supportsHotwords: false, installedState: 'not-downloaded', isCurrent: false, downloadedBytes: 0, totalBytes: 180000000},
    ],
};

const unsubscribeFrom = (listeners, listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

contextBridge.exposeInMainWorld('meetingMonsterSettings', {
    settings: {
        close: async () => undefined,
        getAppVersion: async () => '2.2.5',
    },
    privacy: {
        getStatus: async () => ({captureProtection: 'protected', captureProtectionEnabled: true, platform: 'win32', windowCount: 2}),
    },
    audioInput: {
        get: async () => 'system',
        set: async (mode) => {
            for (const listener of audioInputListeners) listener(mode);
            return mode;
        },
        onChanged: (listener) => unsubscribeFrom(audioInputListeners, listener),
    },
    models: {
        list: async () => structuredClone(modelOptions),
        getSaved: async () => structuredClone(savedModels),
        save: async () => structuredClone(savedModels),
        test: async () => ({ok: true, vision: true, latency_ms: 1, model: 'test-model'}),
        onTestProgress: (listener) => unsubscribeFrom(modelProgressListeners, listener),
    },
    asrModels: {
        list: async () => structuredClone(asrSnapshot),
        select: async () => structuredClone(asrSnapshot),
        download: async () => structuredClone(asrSnapshot),
        cancel: async () => ({cancelled: true}),
        delete: async () => structuredClone(asrSnapshot),
        onStatus: (listener) => unsubscribeFrom(asrStatusListeners, listener),
    },
});
