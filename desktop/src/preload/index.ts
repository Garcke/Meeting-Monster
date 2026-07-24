import {contextBridge, ipcRenderer} from 'electron';
import {
    IPC_CHANNELS,
    type MeetingMonsterApi,
    type PrivacyStatus,
    type ChatStreamEvent,
    type AsrModelId,
    type AsrModelSnapshot,
    type AsrResultEvent,
    type AsrStatus,
    type ModelOptions,
    type ModelConnectionInput,
    type ModelSelectionInput,
    type SavedModelConnectionSettings,
    type ModelTestResult,
    type OverlayIntent,
    type OverlaySnapshot,
    type Unsubscribe,
    type WindowState,
} from '../shared/contracts';

let pcmPort: MessagePort | null = null;
let pendingPcmPort: {
    resolve: () => void;
    reject: (error: Error) => void;
} | null = null;
const asrStatusSubscribers = new Set<(status: AsrStatus) => void>();

function closePcmPort(): void {
    pcmPort?.close();
    pcmPort = null;
    const pending = pendingPcmPort;
    pendingPcmPort = null;
    pending?.reject(new Error('ASR PCM channel is unavailable'));
}

function waitForPcmPort(): Promise<void> {
    if (pcmPort) return Promise.resolve();
    return new Promise((resolve, reject) => {
        pendingPcmPort = {resolve, reject};
    });
}

ipcRenderer.on(IPC_CHANNELS.asr.port, (event) => {
    const port = event.ports[0];
    if (!port) {
        closePcmPort();
        const status: AsrStatus = {state: 'error', message: 'ASR PCM channel is unavailable'};
        for (const callback of asrStatusSubscribers) callback(status);
        return;
    }
    pcmPort?.close();
    pcmPort = port;
    const pending = pendingPcmPort;
    pendingPcmPort = null;
    pending?.resolve();
});

function subscribe<T>(channel: string, callback: (value: T) => void): Unsubscribe {
    if (typeof callback !== 'function') throw new TypeError('Meeting Monster event callback must be a function');
    const listener = (_event: unknown, value: T) => callback(value);
    ipcRenderer.on(channel, listener);
    let subscribed = true;
    return () => {
        if (!subscribed) return;
        subscribed = false;
        ipcRenderer.removeListener(channel, listener);
    };
}

const meetingMonster: MeetingMonsterApi = {
    window: {
        getState: () => ipcRenderer.invoke(IPC_CHANNELS.window.getState),
        setExpanded: (expanded) => ipcRenderer.invoke(IPC_CHANNELS.window.setExpanded, Boolean(expanded)),
        toggleExpanded: () => ipcRenderer.invoke(IPC_CHANNELS.window.toggleExpanded),
        hide: () => ipcRenderer.invoke(IPC_CHANNELS.window.hide),
        quit: () => ipcRenderer.invoke(IPC_CHANNELS.window.quit) as Promise<void>,
        show: () => ipcRenderer.invoke(IPC_CHANNELS.window.show),
        onState: (callback: (state: WindowState) => void) => subscribe(IPC_CHANNELS.window.state, callback),
    },
    overlay: {
        intent: (intent: OverlayIntent) => ipcRenderer.invoke(IPC_CHANNELS.overlay.intent, intent) as Promise<OverlaySnapshot>,
        getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.overlay.getSnapshot) as Promise<OverlaySnapshot>,
        rendererReady: (revision) => ipcRenderer.invoke(IPC_CHANNELS.overlay.rendererReady, revision),
        panelReady: (revision) => ipcRenderer.invoke(IPC_CHANNELS.overlay.rendererReady, revision),
        animationFinished: (revision) => ipcRenderer.invoke(IPC_CHANNELS.overlay.animationFinished, revision),
        onSnapshot: (callback: (snapshot: OverlaySnapshot) => void) => subscribe(IPC_CHANNELS.overlay.snapshot, callback),
        onWindowError: (callback: (error: string) => void) => subscribe(IPC_CHANNELS.overlay.windowError, callback),
    },
    privacy: {
        getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.privacy.getStatus),
        getPolicy: () => ipcRenderer.invoke(IPC_CHANNELS.privacy.getPolicy),
        setCaptureProtection: (enabled) => ipcRenderer.invoke(
            IPC_CHANNELS.privacy.setCaptureProtection,
            Boolean(enabled),
        ),
        onStatus: (callback: (status: PrivacyStatus) => void) => subscribe(IPC_CHANNELS.privacy.status, callback),
    },
    models: {
        list: () => ipcRenderer.invoke(IPC_CHANNELS.models.list) as Promise<ModelOptions>,
        getSaved: () => ipcRenderer.invoke(IPC_CHANNELS.models.getSaved) as Promise<SavedModelConnectionSettings>,
        save: (connection: ModelConnectionInput) => ipcRenderer.invoke(IPC_CHANNELS.models.save, connection) as Promise<SavedModelConnectionSettings>,
        test: (selection: ModelSelectionInput) => ipcRenderer.invoke(IPC_CHANNELS.models.test, selection) as Promise<ModelTestResult>,
    },
    chat: {
        send: (requestId, content, selection) => ipcRenderer.invoke(IPC_CHANNELS.chat.send, requestId, content, selection),
        cancel: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.chat.cancel, requestId),
        onEvent: (callback: (event: ChatStreamEvent) => void) => subscribe(IPC_CHANNELS.chat.event, callback),
    },
    asrModels: {
        list: () => ipcRenderer.invoke(IPC_CHANNELS.asrModels.list) as Promise<AsrModelSnapshot>,
        select: (modelId: AsrModelId) => ipcRenderer.invoke(IPC_CHANNELS.asrModels.select, modelId) as Promise<AsrModelSnapshot>,
        download: (modelId: AsrModelId) => ipcRenderer.invoke(IPC_CHANNELS.asrModels.download, modelId) as Promise<AsrModelSnapshot>,
        cancel: (modelId: AsrModelId) => ipcRenderer.invoke(IPC_CHANNELS.asrModels.cancel, modelId) as Promise<{cancelled: boolean}>,
        delete: (modelId: AsrModelId) => ipcRenderer.invoke(IPC_CHANNELS.asrModels.delete, modelId) as Promise<AsrModelSnapshot>,
        onStatus: (callback: (snapshot: AsrModelSnapshot) => void) => subscribe(IPC_CHANNELS.asrModels.status, callback),
    },
    asr: {
        start: async (sampleRate) => {
            try {
                const status = await ipcRenderer.invoke(IPC_CHANNELS.asr.start, sampleRate);
                await waitForPcmPort();
                return status;
            } catch (error) {
                closePcmPort();
                throw error;
            }
        },
        writePcm: (chunk) => {
            if (!(chunk instanceof Int16Array) || chunk.byteLength === 0) {
                throw new TypeError('PCM chunk must be a non-empty Int16Array');
            }
            if (!pcmPort) throw new Error('ASR is not recording');
            const copy = new Int16Array(chunk);
            pcmPort.postMessage(copy);
        },
        stop: async () => {
            try {
                return await ipcRenderer.invoke(IPC_CHANNELS.asr.stop);
            } finally {
                closePcmPort();
            }
        },
        getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.asr.getStatus),
        onStatus: (callback: (status: AsrStatus) => void) => {
            const notify = (status: AsrStatus) => {
            if (status.state === 'error' || status.state === 'idle') closePcmPort();
            callback(status);
            };
            const unsubscribe = subscribe<AsrStatus>(IPC_CHANNELS.asr.status, notify);
            asrStatusSubscribers.add(notify);
            return () => {
                asrStatusSubscribers.delete(notify);
                unsubscribe();
            };
        },
        onResult: (callback: (event: AsrResultEvent) => void) => subscribe(IPC_CHANNELS.asr.result, callback),
    },
};

contextBridge.exposeInMainWorld('meetingMonster', meetingMonster);
