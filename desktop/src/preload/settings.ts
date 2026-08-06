import {contextBridge, ipcRenderer} from 'electron';
import {
    IPC_CHANNELS,
    type AsrModelId,
    type AsrModelSnapshot,
    type ModelConnectionInput,
    type ModelOptions,
    type ModelSelectionInput,
    type ModelTestProgress,
    type ModelTestResult,
    type PrivacyStatus,
    type SavedModelConnectionSettings,
    type SettingsRendererApi,
    type Unsubscribe,
} from '../shared/contracts';

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

const meetingMonsterSettings: SettingsRendererApi = {
    settings: {
        close: () => ipcRenderer.invoke(IPC_CHANNELS.settings.close) as Promise<void>,
        getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.settings.getAppVersion) as Promise<string>,
    },
    privacy: {
        getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.privacy.getStatus) as Promise<PrivacyStatus>,
    },
    models: {
        list: () => ipcRenderer.invoke(IPC_CHANNELS.models.list) as Promise<ModelOptions>,
        getSaved: () => ipcRenderer.invoke(IPC_CHANNELS.models.getSaved) as Promise<SavedModelConnectionSettings>,
        save: (connection: ModelConnectionInput) => ipcRenderer.invoke(IPC_CHANNELS.models.save, connection) as Promise<SavedModelConnectionSettings>,
        test: (selection: ModelSelectionInput) => ipcRenderer.invoke(IPC_CHANNELS.models.test, selection) as Promise<ModelTestResult>,
        onTestProgress: (callback: (progress: ModelTestProgress) => void) => subscribe(IPC_CHANNELS.models.progress, callback),
    },
    asrModels: {
        list: () => ipcRenderer.invoke(IPC_CHANNELS.asrModels.list) as Promise<AsrModelSnapshot>,
        select: (modelId: AsrModelId) => ipcRenderer.invoke(IPC_CHANNELS.asrModels.select, modelId) as Promise<AsrModelSnapshot>,
        download: (modelId: AsrModelId) => ipcRenderer.invoke(IPC_CHANNELS.asrModels.download, modelId) as Promise<AsrModelSnapshot>,
        cancel: (modelId: AsrModelId) => ipcRenderer.invoke(IPC_CHANNELS.asrModels.cancel, modelId) as Promise<{cancelled: boolean}>,
        delete: (modelId: AsrModelId) => ipcRenderer.invoke(IPC_CHANNELS.asrModels.delete, modelId) as Promise<AsrModelSnapshot>,
        onStatus: (callback: (snapshot: AsrModelSnapshot) => void) => subscribe(IPC_CHANNELS.asrModels.status, callback),
    },
};

contextBridge.exposeInMainWorld('meetingMonsterSettings', meetingMonsterSettings);
