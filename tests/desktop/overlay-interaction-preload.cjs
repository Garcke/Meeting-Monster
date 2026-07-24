const {contextBridge} = require('electron');

const snapshotListeners = new Set();
let snapshot = {target: 'settings', phase: 'opening', revision: 1};
const emitSnapshot = () => { for (const listener of snapshotListeners) listener({...snapshot}); };

const modelSnapshot = {
    currentModelId: 'streaming-paraformer-bilingual-zh-en',
    models: [
        {id: 'streaming-paraformer-bilingual-zh-en', label: 'Streaming Paraformer (Chinese + English)', languages: ['zh', 'en'], description: 'Paraformer', estimatedBytes: 226000000, supportsHotwords: false, installedState: 'installed', isCurrent: true, downloadedBytes: 226000000, totalBytes: 226000000},
        {id: 'streaming-zipformer-zh-int8-2025-06-30', label: 'Streaming Zipformer (Chinese)', languages: ['zh'], description: 'Zipformer', estimatedBytes: 180000000, supportsHotwords: false, installedState: 'not-downloaded', isCurrent: false, downloadedBytes: 0, totalBytes: 180000000},
    ],
};

const api = {
    overlay: {
        getSnapshot: async () => ({...snapshot}),
        onSnapshot: (listener) => { snapshotListeners.add(listener); return () => snapshotListeners.delete(listener); },
        onWindowError: () => () => {},
        intent: async (intent) => {
            snapshot = {target: intent.type === 'toggle-settings' ? 'settings' : 'workspace', phase: 'opening', revision: snapshot.revision + 1};
            emitSnapshot();
            return {...snapshot};
        },
        rendererReady: async (revision) => {
            if (revision === snapshot.revision) snapshot = {...snapshot, phase: 'visible'};
            emitSnapshot();
            return {...snapshot};
        },
        panelReady: async (revision) => api.overlay.rendererReady(revision),
        animationFinished: async (revision) => ({...snapshot, revision}),
    },
    privacy: {
        getStatus: async () => ({captureProtection: 'protected', captureProtectionEnabled: true, platform: 'win32', windowCount: 1}),
        onStatus: () => () => {},
        setCaptureProtection: async () => ({captureProtection: 'protected', captureProtectionEnabled: true, platform: 'win32', windowCount: 1}),
    },
    models: {
        list: async () => ({active_profile: 'generic_openai', profiles: []}),
        getSaved: async () => null,
        save: async (selection) => ({...selection, protocol: 'openai', has_api_key: false}),
        test: async () => ({ok: true, latency_ms: 1, model: 'test-model'}),
    },
    asrModels: {
        list: async () => structuredClone(modelSnapshot),
        onStatus: () => () => {},
        select: async () => structuredClone(modelSnapshot),
        download: async () => structuredClone(modelSnapshot),
        cancel: async () => ({cancelled: true}),
        delete: async () => structuredClone(modelSnapshot),
    },
    chat: {onEvent: () => () => {}, send: async () => ({}), cancel: async () => ({cancelled: false})},
    asr: {onStatus: () => () => {}, onResult: () => () => {}, getStatus: async () => ({state: 'idle'}), start: async () => ({state: 'idle'}), stop: async () => ({state: 'idle'}), writePcm: () => {}},
    window: {getState: async () => ({mode: 'expanded', visible: true}), setExpanded: async () => ({mode: 'expanded', visible: true}), toggleExpanded: async () => ({mode: 'expanded', visible: true}), hide: async () => ({mode: 'expanded', visible: false}), show: async () => ({mode: 'expanded', visible: true}), onState: () => () => {}},
};

contextBridge.exposeInMainWorld('meetingMonster', api);
