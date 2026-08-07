import {app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, MessageChannelMain, safeStorage, screen, session, webContents, type WebContents} from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {AsrModelManager} from './asr-model-manager';
import {AudioInputSettingsStore} from './audio-input-settings';
import {getAsrModel, getAsrModelCatalog, toPublicAsrModelDescriptor} from './asr-model-catalog';
import {
    ModelConnectionStore,
    type ModelConnection,
    type ModelConnectionCandidate,
} from './model-connection-settings';
import {WindowPrivacyManager} from './privacy-manager';
import {
    RemoteApiClient,
    validateModelSelectionInput,
    type ChatStreamEvent,
    type ModelSelectionInput,
} from './remote-api-client';
import {AsrSessionCoordinator, type AsrSessionSender} from './asr-session-coordinator';
import {LocalAsrEngine, type SherpaBinding} from './local-asr-engine';
import {captureCurrentDisplay} from './screen-capture';
import {runModelTestWithVisionRetries} from './model-test-coordinator';
import {
    createOverlayWindowController,
    CAPSULE_BOUNDS,
    type BrowserWindowLike,
    type OverlayWindowController,
} from './overlay-window-controller';
import {
    createSettingsWindowController,
    type SettingsBrowserWindowConstructor,
    type SettingsWindowController,
} from './settings-window-controller';
import {
    IPC_CHANNELS,
    type ChatImageInput,
    type AsrModelId,
    type AsrModelSnapshot,
    type AsrModelState,
    type AsrResultEvent,
    type AsrStatus,
    type OverlayIntent,
    type OverlaySnapshot,
    type PrivacyPolicy,
    type WindowState,
    type WorkspaceCommand,
} from '../shared/contracts';
import {normalizeAudioInputMode, type AudioInputMode} from '../shared/audio-input-mode';

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:9000/';
const LOCAL_ASR_ERROR = 'Local ASR failed';
const ASR_MODEL_ERROR = 'ASR model operation failed';
const ASSIST_SCREENSHOT_PROMPT = '请分析这张截图，并直接回答截图中显示的问题；如果有多个问题，请按顺序回答。';

// Some Windows environments cannot start Chromium's out-of-process GPU DLL.
// Keep the transparent overlay on the software/in-process rendering path so
// the desktop shell can still start and remain interactive.
if (typeof app.disableHardwareAcceleration === 'function') app.disableHardwareAcceleration();
if (app.commandLine?.appendSwitch) app.commandLine.appendSwitch('in-process-gpu');

let mainWindow: BrowserWindow | null = null;
let overlayController: OverlayWindowController | null = null;
let settingsWindowController: SettingsWindowController | null = null;
let privacyManager: WindowPrivacyManager | null = null;
let modelConnectionStore: ModelConnectionStore | null = null;
let audioInputSettingsStore: AudioInputSettingsStore | null = null;
let ipcHandlersRegistered = false;
type ActiveChatRequest = {
    controller: AbortController;
    sender: WebContents;
    phase: 'capturing' | 'streaming';
};
const activeChatRequests = new Map<string, ActiveChatRequest>();
let asrModelManager: AsrModelManager | null = null;
let localAsrEngine: LocalAsrEngine | null = null;
let asrSessionCoordinator: AsrSessionCoordinator | null = null;
let loadedAsrModelId: AsrModelId | null = null;
let asrModelMutationActive = false;
const asrModelRuntime = new Map<AsrModelId, {state: 'loading' | 'ready' | 'failed'; errorMessage?: string}>();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let secondInstancePending = false;

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const overlay = overlayController?.getWindow() as unknown as BrowserWindow | null;
        if (!overlay || overlay.isDestroyed()) {
            secondInstancePending = true;
            return;
        }
        if (overlay.isMinimized()) overlay.restore();
        overlay.show();
        overlay.focus();
        broadcastWindowState();
    });
}

function isLiveWindowSender(sender: WebContents, window: BrowserWindow | null): boolean {
    return Boolean(
        !sender.isDestroyed()
        && window
        && !window.isDestroyed()
        && !window.webContents.isDestroyed()
        && BrowserWindow.fromWebContents(sender) === window,
    );
}

function isOverlayWebContents(sender: WebContents): boolean {
    return isLiveWindowSender(sender, overlayController?.getWindow() as BrowserWindow | null);
}

function isSettingsWebContents(sender: WebContents): boolean {
    return isLiveWindowSender(sender, settingsWindowController?.getWindow() as BrowserWindow | null);
}

function isApplicationWebContents(sender: WebContents): boolean {
    return isOverlayWebContents(sender) || isSettingsWebContents(sender);
}

function configureDisplayMediaCapture(): void {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        const requester = request.frame ? webContents.fromFrame(request.frame) : undefined;
        if (process.platform !== 'win32' || !requester || !isOverlayWebContents(requester)) {
            callback({});
            return;
        }

        void desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {width: 0, height: 0},
        }).then((sources) => {
            const source = sources[0];
            if (!source) {
                callback({});
                return;
            }
            if (request.audioRequested) {
                callback({video: source, audio: 'loopback'});
                return;
            }
            callback({video: source});
        }).catch(() => callback({}));
    });
}

function getLiveOverlayWindows(): BrowserWindow[] {
    const win = overlayController?.getWindow() as unknown as BrowserWindow | null;
    return win && !win.isDestroyed() && !win.webContents.isDestroyed() ? [win] : [];
}

function getLiveSettingsWindows(): BrowserWindow[] {
    const win = settingsWindowController?.getWindow() as BrowserWindow | null;
    return win && !win.isDestroyed() && !win.webContents.isDestroyed() ? [win] : [];
}

function getLiveApplicationWindows(): BrowserWindow[] {
    return [...getLiveOverlayWindows(), ...getLiveSettingsWindows()];
}

function getPrivacyManager(): WindowPrivacyManager {
    if (!privacyManager) throw new Error('Privacy manager is not ready');
    return privacyManager;
}

function getModelConnectionStore(): ModelConnectionStore {
    if (!modelConnectionStore) throw new Error('Model connection store is not ready');
    return modelConnectionStore;
}

function getAudioInputSettingsStore(): AudioInputSettingsStore {
    if (!audioInputSettingsStore) throw new Error('Audio input settings store is not ready');
    return audioInputSettingsStore;
}

function getAsrModelManager(): AsrModelManager {
    if (!asrModelManager) throw new Error('ASR model manager is not ready');
    return asrModelManager;
}

function requireAsrModelId(value: unknown): AsrModelId {
    if (typeof value !== 'string') throw new Error('Unknown ASR model');
    try {
        return getAsrModel(value as AsrModelId).id;
    } catch {
        throw new Error('Unknown ASR model');
    }
}

function getPublicAsrModelSnapshot(): AsrModelSnapshot {
    const snapshot = getAsrModelManager().snapshot;
    return {
        currentModelId: snapshot.currentModelId,
        models: getAsrModelCatalog().map((descriptor) => {
            const progress = snapshot.models.find((model) => model.id === descriptor.id)!;
            const runtime = asrModelRuntime.get(descriptor.id);
            const installedState: AsrModelState = progress.state === 'installed' && runtime
                ? runtime.state
                : progress.state;
            return {
                ...toPublicAsrModelDescriptor(
                    descriptor,
                    installedState,
                    descriptor.id === snapshot.currentModelId,
                ),
                downloadedBytes: progress.downloadedBytes,
                totalBytes: progress.totalBytes,
                ...(installedState === 'failed'
                    ? {errorMessage: runtime?.errorMessage ?? ASR_MODEL_ERROR}
                    : {}),
            };
        }),
    };
}

function broadcastAsrModelStatus(): void {
    const snapshot = getPublicAsrModelSnapshot();
    for (const win of getLiveApplicationWindows()) win.webContents.send(IPC_CHANNELS.asrModels.status, snapshot);
}

function broadcastAudioInputChanged(mode: AudioInputMode): void {
    for (const win of getLiveApplicationWindows()) win.webContents.send(IPC_CHANNELS.audioInput.changed, mode);
}

function broadcastModelChanged(): void {
    for (const win of getLiveApplicationWindows()) win.webContents.send(IPC_CHANNELS.models.changed);
}

function setAsrModelRuntime(
    id: AsrModelId,
    state: 'loading' | 'ready' | 'failed',
    errorMessage?: string,
): void {
    asrModelRuntime.set(id, {state, ...(errorMessage ? {errorMessage} : {})});
    broadcastAsrModelStatus();
}

function getLiveAsrOwner(): WebContents | null {
    const owner = asrSessionCoordinator?.getOwner() as WebContents | null;
    if (!owner || !isOverlayWebContents(owner)) {
        return null;
    }
    return owner;
}

function sendAsrStatus(status: AsrStatus): void {
    const owner = getLiveAsrOwner();
    if (owner) owner.send(IPC_CHANNELS.asr.status, status);
}

function sendAsrResult(event: AsrResultEvent): void {
    const owner = getLiveAsrOwner();
    if (owner) owner.send(IPC_CHANNELS.asr.result, event);
}

function terminateAsr(owner: AsrSessionSender): void {
    const sender = owner as WebContents;
    if (isOverlayWebContents(sender)) {
        sender.send(IPC_CHANNELS.asr.result, {type: 'error', text: LOCAL_ASR_ERROR});
        sender.send(IPC_CHANNELS.asr.status, {state: 'error', message: LOCAL_ASR_ERROR});
    }
}

function disposeAsr(): void {
    asrSessionCoordinator?.endSession();
    for (const descriptor of getAsrModelCatalog()) asrModelManager?.cancel(descriptor.id);
    localAsrEngine?.dispose();
    localAsrEngine = null;
    loadedAsrModelId = null;
    asrModelRuntime.clear();
}

function loadSherpaBinding(): SherpaBinding {
    const moduleName = 'sherpa\x2donnx\x2dnode';
    return require(moduleName) as SherpaBinding;
}

function createLocalAsrEngine(): LocalAsrEngine {
    return new LocalAsrEngine({
        binding: loadSherpaBinding(),
        resolveModelDirectory: (id) => getAsrModelManager().getModelDirectory(id),
    });
}

function subscribeToLocalAsrEngine(engine: LocalAsrEngine, id: AsrModelId): void {
    engine.onResult((event) => {
        sendAsrResult(event);
        if (event.type !== 'error') return;
        setAsrModelRuntime(id, 'failed', LOCAL_ASR_ERROR);
        sendAsrStatus({state: 'error', message: LOCAL_ASR_ERROR});
        asrSessionCoordinator?.endSession();
    });
}

async function selectInstalledAsrModel(
    id: AsrModelId,
    options: {selectionAlreadyPersisted?: boolean; rollbackModelId?: AsrModelId} = {},
): Promise<AsrModelSnapshot> {
    const manager = getAsrModelManager();
    const installed = manager.snapshot.models.find((model) => model.id === id);
    if (installed?.state !== 'installed') throw new Error('ASR model is not installed');

    const previousEngine = localAsrEngine;
    const previousRuntime = asrModelRuntime.get(id);
    const preservePreviousRuntime = loadedAsrModelId === id
        && previousRuntime?.state === 'ready'
        && previousEngine?.getStatus().state !== 'error';
    setAsrModelRuntime(id, 'loading');
    try {
        const candidateEngine = createLocalAsrEngine();
        try {
            await candidateEngine.load(id);
            if (!options.selectionAlreadyPersisted) await manager.selectModel(id);
            subscribeToLocalAsrEngine(candidateEngine, id);
            localAsrEngine = candidateEngine;
            loadedAsrModelId = id;
            previousEngine?.dispose();
            setAsrModelRuntime(id, 'ready');
            return getPublicAsrModelSnapshot();
        } catch (error) {
            candidateEngine.dispose();
            throw error;
        }
    } catch {
        const rollbackId = options.rollbackModelId;
        const rollbackInstalled = rollbackId
            ? manager.snapshot.models.find((model) => model.id === rollbackId)?.state === 'installed'
            : false;
        if (options.selectionAlreadyPersisted && rollbackId && rollbackId !== id && rollbackInstalled) {
            try { await manager.selectModel(rollbackId); } catch {}
        }
        if (preservePreviousRuntime) {
            asrModelRuntime.set(id, previousRuntime);
            broadcastAsrModelStatus();
        } else {
            setAsrModelRuntime(id, 'failed', ASR_MODEL_ERROR);
        }
        throw new Error('ASR model operation failed');
    }
}

function assertAsrModelMutationAllowed(): void {
    if (asrSessionCoordinator?.isActive() || localAsrEngine?.getStatus().state === 'recording') {
        throw new Error('Cannot change ASR models while recording');
    }
}

async function runAsrModelMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (asrModelMutationActive) throw new Error(ASR_MODEL_ERROR);
    asrModelMutationActive = true;
    try {
        return await operation();
    } finally {
        asrModelMutationActive = false;
    }
}

function sanitizeAsrModelError(error: unknown): Error {
    const message = error instanceof Error ? error.message : '';
    if (/^Insufficient free space: required \d+ bytes, available \d+ bytes$/.test(message)) return new Error(message);
    if (/cancel/i.test(message)) return new Error('ASR model download cancelled');
    return new Error(ASR_MODEL_ERROR);
}

function isAsrModelDownloadCancellation(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    return (error instanceof Error && error.name === 'AbortError') || /\bcancel(?:led|lation)?\b/i.test(message);
}

function releaseCurrentAsrEngineForDelete(id: AsrModelId): void {
    if (getAsrModelManager().snapshot.currentModelId !== id) return;
    asrSessionCoordinator?.endSession();
    localAsrEngine?.dispose();
    localAsrEngine = null;
    loadedAsrModelId = null;
    asrModelRuntime.delete(id);
}

function assertCurrentAsrModelReady(): void {
    const snapshot = getAsrModelManager().snapshot;
    const installed = snapshot.models.find((model) => model.id === snapshot.currentModelId)?.state === 'installed';
    const ready = asrModelRuntime.get(snapshot.currentModelId)?.state === 'ready';
    if (!installed || !ready || loadedAsrModelId !== snapshot.currentModelId || !localAsrEngine) {
        throw new Error('Local ASR model is not ready');
    }
}

function getLocalAsrStatus(): AsrStatus {
    const status = localAsrEngine?.getStatus();
    if (status?.state === 'recording') return {state: 'recording'};
    if (status?.state === 'error') return {state: 'error', ...(status.message ? {message: status.message} : {})};
    return {state: 'idle'};
}

function getAsrSessionCoordinator(): AsrSessionCoordinator {
    if (asrSessionCoordinator) return asrSessionCoordinator;
    asrSessionCoordinator = new AsrSessionCoordinator({
        isAuthorizedSender: (sender) => isOverlayWebContents(sender as WebContents),
        createPort: () => {
            const {port1, port2} = new MessageChannelMain();
            return {input: port1, output: port2};
        },
        startEngine: async (sampleRate) => {
            const status = await localAsrEngine!.start(sampleRate);
            if (status.state !== 'recording') throw new Error(LOCAL_ASR_ERROR);
            const result: AsrStatus = {state: 'recording'};
            sendAsrStatus(result);
            return result;
        },
        writePcm: (buffer) => localAsrEngine!.acceptPcm(new Int16Array(buffer)),
        stopEngine: async () => {
            const status = await localAsrEngine!.stop();
            if (loadedAsrModelId && status.state !== 'error') setAsrModelRuntime(loadedAsrModelId, 'ready');
            const result: AsrStatus = status.state === 'error'
                ? {state: 'error', message: LOCAL_ASR_ERROR}
                : {state: 'idle'};
            sendAsrStatus(result);
            return result;
        },
        onPortError: terminateAsr,
        portChannel: IPC_CHANNELS.asr.port,
    });
    return asrSessionCoordinator;
}

async function initializeAsr(): Promise<void> {
    const asrModelRoot = path.join(app.getPath('home'), '.cache', 'meeting-monster', 'models', 'asr');
    const manager = new AsrModelManager({
        modelRoot: asrModelRoot,
        getFreeBytes: async () => {
            const stats = await fsp.statfs(asrModelRoot);
            return stats.bavail * stats.bsize;
        },
    });
    asrModelManager = manager;
    manager.subscribe(() => broadcastAsrModelStatus());
    await manager.initialize();
    const {currentModelId, models} = manager.snapshot;
    if (models.find((model) => model.id === currentModelId)?.state === 'installed') {
        try {
            await selectInstalledAsrModel(currentModelId, {selectionAlreadyPersisted: true});
        } catch {}
    }
}

function getRemoteApiClient(): RemoteApiClient {
    return new RemoteApiClient({baseUrl: DEFAULT_BACKEND_URL, fetch});
}

function requireText(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
    return value.trim();
}

function requireModelSelection(value: unknown): ModelSelectionInput {
    return validateModelSelectionInput(value);
}

async function mergeSavedModelConnection(selection: ModelSelectionInput | undefined): Promise<ModelSelectionInput | undefined> {
    const settings = await getModelConnectionStore().loadSettings();
    const saved = selection
        ? settings?.connections[selection.profile_id]
        : settings?.connections[settings.active_profile];
    if (!selection) return saved ? modelConnectionToSelection(saved) : undefined;

    const sameIdentity = Boolean(saved
        && saved.profile_id === selection.profile_id
        && saved.protocol === selection.protocol
        && saved.base_url === selection.base_url
        && saved.model === selection.model);
    return {
        ...selection,
        ...(selection.api_key
            ? {api_key: selection.api_key}
            : (sameIdentity && saved?.api_key ? {api_key: saved.api_key} : {})),
        max_tokens: selection.max_tokens ?? (sameIdentity && saved ? saved.max_tokens : 4096),
        ...(selection.temperature !== undefined
            ? {temperature: selection.temperature}
            : (sameIdentity && saved?.temperature !== undefined ? {temperature: saved.temperature} : {})),
    };
}

function modelConnectionToSelection(connection: ModelConnection): ModelSelectionInput {
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

function modelSelectionToConnection(selection: ModelSelectionInput): ModelConnectionCandidate {
    return {
        profile_id: selection.profile_id,
        protocol: selection.protocol,
        base_url: selection.base_url,
        model: selection.model,
        ...(selection.api_key ? {api_key: selection.api_key} : {}),
        max_tokens: selection.max_tokens ?? 4096,
        ...(selection.temperature === undefined ? {} : {temperature: selection.temperature}),
    };
}

async function requireVerifiedSavedSelection(
    selection: ModelSelectionInput | undefined,
): Promise<ModelSelectionInput> {
    let settings: Awaited<ReturnType<ModelConnectionStore['loadSettings']>>;
    try {
        settings = await getModelConnectionStore().loadSettings();
    } catch {
        throw new Error('Model image capability is not verified');
    }
    if (!settings) throw new Error('Model image capability is not verified');
    const saved = selection
        ? settings.connections[selection.profile_id]
        : settings.connections[settings.active_profile];
    const sameIdentity = Boolean(saved
        && (!selection || (
            saved.profile_id === selection.profile_id
            && saved.protocol === selection.protocol
            && saved.base_url === selection.base_url
            && saved.model === selection.model
        )));
    if (!saved || !sameIdentity || saved.vision_verified !== true) {
        throw new Error('Model image capability is not verified');
    }
    return modelConnectionToSelection(saved);
}

function reserveChatRequest(id: string, sender: WebContents): ActiveChatRequest {
    activeChatRequests.get(id)?.controller.abort();
    const request: ActiveChatRequest = {
        controller: new AbortController(),
        sender,
        phase: 'capturing',
    };
    activeChatRequests.set(id, request);
    return request;
}

function isCurrentChatRequest(id: string, request: ActiveChatRequest): boolean {
    return activeChatRequests.get(id) === request && !request.controller.signal.aborted;
}

function releaseChatRequest(id: string, request: ActiveChatRequest): void {
    if (activeChatRequests.get(id) === request) activeChatRequests.delete(id);
}

function startChatRequest(args: {
    id: string;
    content: string;
    sender: WebContents;
    modelSelection?: ModelSelectionInput;
    image?: ChatImageInput;
    reserved?: ActiveChatRequest;
}): boolean {
    if (args.reserved && (!isCurrentChatRequest(args.id, args.reserved)
        || args.reserved.sender !== args.sender
        || args.reserved.phase !== 'capturing')) return false;
    const active = args.reserved ?? reserveChatRequest(args.id, args.sender);
    active.phase = 'streaming';
    const {controller} = active;
    void (async () => {
        try {
            for await (const chatEvent of getRemoteApiClient().streamChat({
                requestId: args.id,
                content: args.content,
                modelSelection: args.modelSelection,
                ...(args.image ? {image: args.image} : {}),
                signal: controller.signal,
            })) {
                if (activeChatRequests.get(args.id)?.controller !== controller) return;
                sendChatEvent(args.sender, chatEvent);
            }
        } catch {
            if (!controller.signal.aborted && activeChatRequests.get(args.id)?.controller === controller) {
                sendChatEvent(args.sender, {
                    requestId: args.id,
                    type: 'error',
                    text: 'Remote chat request failed',
                });
            }
        } finally {
            if (activeChatRequests.get(args.id)?.controller === controller) activeChatRequests.delete(args.id);
        }
    })();
    return true;
}

function sendChatEvent(sender: WebContents, event: ChatStreamEvent): void {
    if (!isOverlayWebContents(sender)) return;
    sender.send(IPC_CHANNELS.chat.event, event);
}

function getOverlaySnapshot(): OverlaySnapshot {
    return overlayController?.getSnapshot() ?? {target: 'closed', phase: 'hidden', revision: 0};
}

function broadcastOverlaySnapshot(snapshot?: OverlaySnapshot): void {
    const nextSnapshot = snapshot ?? getOverlaySnapshot();
    for (const win of getLiveOverlayWindows()) win.webContents.send(IPC_CHANNELS.overlay.snapshot, nextSnapshot);
}

function requireOverlayIntent(value: unknown): OverlayIntent {
    if (!value || typeof value !== 'object' || !('type' in value)) throw new TypeError('Invalid overlay intent');
    const type = (value as {type?: unknown}).type;
    if (type !== 'toggle-workspace') throw new TypeError('Invalid overlay intent');
    return {type: 'toggle-workspace'};
}

function requireWorkspaceCommand(value: unknown): WorkspaceCommand {
    if (!value || typeof value !== 'object' || !('type' in value)) {
        throw new TypeError('Invalid workspace command');
    }
    const candidate = value as {type?: unknown; direction?: unknown};
    if (candidate.type === 'toggle-transcription' || candidate.type === 'clear-chat') {
        return {type: candidate.type};
    }
    if (candidate.type === 'scroll-chat'
        && (candidate.direction === 'up' || candidate.direction === 'down')) {
        return {type: 'scroll-chat', direction: candidate.direction};
    }
    throw new TypeError('Invalid workspace command');
}

function sendWorkspaceCommand(command: WorkspaceCommand): void {
    const overlay = getLiveOverlayWindows()[0];
    if (!overlay) return;
    overlay.webContents.send(IPC_CHANNELS.workspaceCommands.event, command);
}

async function dispatchOverlayIntent(intent: OverlayIntent): Promise<OverlaySnapshot> {
    if (!overlayController) throw new Error('Overlay controller is not ready');
    const snapshot = await overlayController.dispatch(intent);
    broadcastOverlaySnapshot(snapshot);
    broadcastWindowState();
    return snapshot;
}

function getWindowState(): WindowState {
    const snapshot = getOverlaySnapshot();
    return {
        mode: snapshot.target === 'closed' ? 'capsule' : 'expanded',
        visible: getLiveOverlayWindows().some((win) => win.isVisible()),
    };
}

function setOverlayVisibility(visible: boolean): void {
    const overlay = overlayController?.getWindow() as unknown as BrowserWindow | null;
    if (!visible) {
        overlay?.hide();
    } else {
        overlay?.show();
    }
    broadcastWindowState();
}

function broadcastWindowState(): void {
    const state = getWindowState();
    for (const win of getLiveOverlayWindows()) win.webContents.send(IPC_CHANNELS.window.state, state);
}

function broadcastPrivacyStatus(): void {
    const manager = getPrivacyManager();
    const status = manager.getStatus();
    for (const win of getLiveApplicationWindows()) win.webContents.send(IPC_CHANNELS.privacy.status, status);
}

async function setLegacyExpanded(expanded: boolean): Promise<WindowState> {
    const target = getOverlaySnapshot().target;
    if (expanded) {
        if (target !== 'workspace') await dispatchOverlayIntent({type: 'toggle-workspace'});
    } else if (target === 'workspace') {
        await dispatchOverlayIntent({type: 'toggle-workspace'});
    }
    return getWindowState();
}

async function toggleLegacyExpanded(): Promise<WindowState> {
    const target = getOverlaySnapshot().target;
    if (target === 'workspace') await dispatchOverlayIntent({type: 'toggle-workspace'});
    else await dispatchOverlayIntent({type: 'toggle-workspace'});
    return getWindowState();
}

function registerIpcHandlers(): void {
    if (ipcHandlersRegistered) return;

    const handledChannels = [
        ...Object.values(IPC_CHANNELS.window).filter((channel) => channel !== IPC_CHANNELS.window.state),
        ...Object.values(IPC_CHANNELS.privacy).filter((channel) => channel !== IPC_CHANNELS.privacy.status),
        ...Object.values(IPC_CHANNELS.audioInput).filter((channel) => channel !== IPC_CHANNELS.audioInput.changed),
        ...Object.values(IPC_CHANNELS.settings),
        ...Object.values(IPC_CHANNELS.models).filter((channel) => (
            channel !== IPC_CHANNELS.models.progress && channel !== IPC_CHANNELS.models.changed
        )),
        ...Object.values(IPC_CHANNELS.chat).filter((channel) => channel !== IPC_CHANNELS.chat.event),
        ...Object.values(IPC_CHANNELS.asrModels).filter((channel) => channel !== IPC_CHANNELS.asrModels.status),
        ...Object.values(IPC_CHANNELS.asr).filter((channel) => (
            channel !== IPC_CHANNELS.asr.status && channel !== IPC_CHANNELS.asr.result && channel !== IPC_CHANNELS.asr.port
        )),
        ...Object.values(IPC_CHANNELS.overlay).filter((channel) => (
            channel !== IPC_CHANNELS.overlay.snapshot && channel !== IPC_CHANNELS.overlay.windowError
        )),
        IPC_CHANNELS.workspaceCommands.dispatch,
    ];
    for (const channel of handledChannels) ipcMain.removeHandler(channel);

    ipcMain.handle(IPC_CHANNELS.settings.open, async (event) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized settings request');
        if (!settingsWindowController) throw new Error('Settings window is not ready');
        await settingsWindowController.open();
        await setLegacyExpanded(false);
    });
    ipcMain.handle(IPC_CHANNELS.settings.close, (event) => {
        if (!isSettingsWebContents(event.sender)) throw new Error('Unauthorized settings request');
        settingsWindowController?.close();
    });
    ipcMain.handle(IPC_CHANNELS.settings.getAppVersion, (event) => {
        if (!isSettingsWebContents(event.sender)) throw new Error('Unauthorized settings request');
        return app.getVersion();
    });
    ipcMain.handle(IPC_CHANNELS.privacy.getStatus, (event) => {
        if (!isApplicationWebContents(event.sender)) throw new Error('Unauthorized privacy request');
        return getPrivacyManager().getStatus();
    });
    ipcMain.handle(IPC_CHANNELS.audioInput.get, async (event) => {
        if (!isApplicationWebContents(event.sender)) throw new Error('Unauthorized audio input request');
        return getAudioInputSettingsStore().load();
    });
    ipcMain.handle(IPC_CHANNELS.audioInput.set, async (event, mode: unknown) => {
        if (!isApplicationWebContents(event.sender)) throw new Error('Unauthorized audio input request');
        if (typeof mode !== 'string' || !['system', 'microphone', 'mixed'].includes(mode)) {
            throw new TypeError('Invalid audio input mode');
        }
        const saved = await getAudioInputSettingsStore().save(normalizeAudioInputMode(mode, process.platform));
        broadcastAudioInputChanged(saved);
        return saved;
    });
    ipcMain.handle(IPC_CHANNELS.privacy.getPolicy, (event): PrivacyPolicy => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized privacy request');
        return {
            captureProtectionDefault: true,
            supportedPlatforms: ['win32', 'darwin'],
            captureProtectionShortcut: 'CommandOrControl+Shift+P',
            taskbarHidden: true,
        };
    });
    ipcMain.handle(IPC_CHANNELS.privacy.setCaptureProtection, (event, enabled: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized privacy request');
        if (typeof enabled !== 'boolean') throw new TypeError('capture protection state must be boolean');
        const manager = getPrivacyManager();
        manager.setCaptureProtection(enabled);
        return manager.getStatus();
    });
    ipcMain.handle(IPC_CHANNELS.window.getState, (event) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized window request');
        return getWindowState();
    });
    ipcMain.handle(IPC_CHANNELS.window.setExpanded, (event, expanded: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized window request');
        if (typeof expanded !== 'boolean') throw new TypeError('expanded state must be boolean');
        return setLegacyExpanded(expanded);
    });
    ipcMain.handle(IPC_CHANNELS.window.toggleExpanded, (event) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized window request');
        return toggleLegacyExpanded();
    });
    ipcMain.handle(IPC_CHANNELS.window.hide, (event) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized window request');
        setOverlayVisibility(false);
        return getWindowState();
    });
    ipcMain.handle(IPC_CHANNELS.window.quit, (event) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized window request');
        setImmediate(() => app.quit());
    });
    ipcMain.handle(IPC_CHANNELS.window.show, (event) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized window request');
        setOverlayVisibility(true);
        return getWindowState();
    });
    ipcMain.handle(IPC_CHANNELS.overlay.intent, async (event, intent: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized overlay request');
        return dispatchOverlayIntent(requireOverlayIntent(intent));
    });
    ipcMain.handle(IPC_CHANNELS.overlay.getSnapshot, (event) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized overlay request');
        return getOverlaySnapshot();
    });
    ipcMain.handle(IPC_CHANNELS.overlay.rendererReady, async (event, revision: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized overlay renderer request');
        if (!Number.isInteger(revision) || (revision as number) < 0) throw new TypeError('Invalid overlay revision');
        if (!overlayController) throw new Error('Overlay controller is not ready');
        const snapshot = await overlayController.rendererReady(revision as number);
        broadcastOverlaySnapshot(snapshot);
        broadcastWindowState();
        return snapshot;
    });
    ipcMain.handle(IPC_CHANNELS.overlay.animationFinished, async (event, revision: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized overlay renderer request');
        if (!Number.isInteger(revision) || (revision as number) < 0) throw new TypeError('Invalid overlay revision');
        if (!overlayController) throw new Error('Overlay controller is not ready');
        const snapshot = await overlayController.animationFinished(revision as number);
        broadcastOverlaySnapshot(snapshot);
        broadcastWindowState();
        return snapshot;
    });
    ipcMain.handle(IPC_CHANNELS.workspaceCommands.dispatch, (event, command: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized workspace command request');
        sendWorkspaceCommand(requireWorkspaceCommand(command));
    });
    ipcMain.handle(IPC_CHANNELS.models.list, async (event) => {
        if (!isApplicationWebContents(event.sender)) throw new Error('Unauthorized models request');
        return (await getRemoteApiClient()).listSelectableModels();
    });
    ipcMain.handle(IPC_CHANNELS.models.getSaved, async (event) => {
        if (!isApplicationWebContents(event.sender)) throw new Error('Unauthorized models request');
        return getModelConnectionStore().loadSummary();
    });
    ipcMain.handle(IPC_CHANNELS.models.save, async (event, connection: unknown) => {
        if (!isSettingsWebContents(event.sender)) throw new Error('Unauthorized models request');
        const requested = requireModelSelection(connection);
        const selection = await mergeSavedModelConnection(requested);
        if (!selection) throw new Error('Model selection is required');
        const tested = await runModelTestWithVisionRetries(
            getRemoteApiClient(),
            selection,
            (progress) => event.sender.send(IPC_CHANNELS.models.progress, progress),
        );
        if (!tested.vision) throw new Error('Model does not support image input');
        const saved = await getModelConnectionStore().saveVerifiedConnection(modelSelectionToConnection(selection));
        broadcastModelChanged();
        return saved;
    });
    ipcMain.handle(IPC_CHANNELS.models.test, async (event, selection: unknown) => {
        if (!isSettingsWebContents(event.sender)) throw new Error('Unauthorized models request');
        const modelSelection = await mergeSavedModelConnection(requireModelSelection(selection));
        if (!modelSelection) throw new Error('Model selection is required');
        return runModelTestWithVisionRetries(
            getRemoteApiClient(),
            modelSelection,
            (progress) => event.sender.send(IPC_CHANNELS.models.progress, progress),
        );
    });
    ipcMain.handle(IPC_CHANNELS.chat.send, async (event, requestId: unknown, content: unknown, selection?: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized chat request');
        const id = requireText(requestId, 'Chat request id');
        const question = requireText(content, 'Chat content');
        const requestedSelection = selection === undefined ? undefined : requireModelSelection(selection);
        const reserved = reserveChatRequest(id, event.sender);
        try {
            const modelSelection = await mergeSavedModelConnection(requestedSelection);
            if (!isCurrentChatRequest(id, reserved)) {
                releaseChatRequest(id, reserved);
                return {requestId: id};
            }
            if (!startChatRequest({
                id,
                content: question,
                sender: event.sender,
                modelSelection,
                reserved,
            })) {
                releaseChatRequest(id, reserved);
            }
            return {requestId: id};
        } catch (error) {
            releaseChatRequest(id, reserved);
            throw error;
        }
    });
    ipcMain.handle(IPC_CHANNELS.chat.assist, async (event, requestId: unknown, selection?: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized Assist request');
        const id = requireText(requestId, 'Chat request id');
        const requestedSelection = selection === undefined ? undefined : requireModelSelection(selection);
        const reserved = reserveChatRequest(id, event.sender);
        try {
            const verified = await requireVerifiedSavedSelection(requestedSelection);
            if (!isCurrentChatRequest(id, reserved)) {
                releaseChatRequest(id, reserved);
                return {requestId: id};
            }
            let captured: Awaited<ReturnType<typeof captureCurrentDisplay>>;
            try {
                captured = await captureCurrentDisplay({screen, desktopCapturer});
            } catch {
                if (!isCurrentChatRequest(id, reserved)) {
                    releaseChatRequest(id, reserved);
                    return {requestId: id};
                }
                throw new Error('Unable to capture the current screen');
            }
            if (!isCurrentChatRequest(id, reserved)) {
                releaseChatRequest(id, reserved);
                return {requestId: id};
            }
            const image: ChatImageInput = {media_type: captured.mediaType, data: captured.data};
            if (!startChatRequest({
                id,
                content: ASSIST_SCREENSHOT_PROMPT,
                sender: event.sender,
                modelSelection: verified,
                image,
                reserved,
            })) {
                releaseChatRequest(id, reserved);
            }
            return {requestId: id};
        } catch (error) {
            releaseChatRequest(id, reserved);
            throw error;
        }
    });
    ipcMain.handle(IPC_CHANNELS.chat.cancel, (event, requestId: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized chat request');
        const id = requireText(requestId, 'Chat request id');
        const activeRequest = activeChatRequests.get(id);
        if (!activeRequest || activeRequest.sender !== event.sender) return {cancelled: false};
        activeRequest.controller.abort();
        return {cancelled: true};
    });
    ipcMain.handle(IPC_CHANNELS.asrModels.list, (event): AsrModelSnapshot => {
        if (!isApplicationWebContents(event.sender)) throw new Error('Unauthorized ASR model request');
        return getPublicAsrModelSnapshot();
    });
    ipcMain.handle(IPC_CHANNELS.asrModels.select, async (event, modelId: unknown) => {
        if (!isSettingsWebContents(event.sender)) throw new Error('Unauthorized ASR model request');
        const id = requireAsrModelId(modelId);
        assertAsrModelMutationAllowed();
        return runAsrModelMutation(() => selectInstalledAsrModel(id));
    });
    ipcMain.handle(IPC_CHANNELS.asrModels.download, async (event, modelId: unknown) => {
        if (!isSettingsWebContents(event.sender)) throw new Error('Unauthorized ASR model request');
        const id = requireAsrModelId(modelId);
        assertAsrModelMutationAllowed();
        return runAsrModelMutation(async () => {
            const rollbackModelId = getAsrModelManager().snapshot.currentModelId;
            try {
                await getAsrModelManager().download(id);
                return await selectInstalledAsrModel(id, {selectionAlreadyPersisted: true, rollbackModelId});
            } catch (error) {
                if (isAsrModelDownloadCancellation(error)) {
                    asrModelRuntime.delete(id);
                    broadcastAsrModelStatus();
                    return getPublicAsrModelSnapshot();
                }
                setAsrModelRuntime(id, 'failed', sanitizeAsrModelError(error).message);
                throw sanitizeAsrModelError(error);
            }
        });
    });
    ipcMain.handle(IPC_CHANNELS.asrModels.cancel, (event, modelId: unknown) => {
        if (!isSettingsWebContents(event.sender)) throw new Error('Unauthorized ASR model request');
        const id = requireAsrModelId(modelId);
        return {cancelled: getAsrModelManager().cancel(id)};
    });
    ipcMain.handle(IPC_CHANNELS.asrModels.delete, async (event, modelId: unknown) => {
        if (!isSettingsWebContents(event.sender)) throw new Error('Unauthorized ASR model request');
        const id = requireAsrModelId(modelId);
        assertAsrModelMutationAllowed();
        return runAsrModelMutation(async () => {
            const deletingCurrent = getAsrModelManager().snapshot.currentModelId === id;
            try {
                releaseCurrentAsrEngineForDelete(id);
                await getAsrModelManager().delete(id);
                asrModelRuntime.delete(id);
                const fallback = getAsrModelManager().snapshot;
                const fallbackInstalled = fallback.models.find((model) => (
                    model.id === fallback.currentModelId && model.state === 'installed'
                ));
                if (fallbackInstalled) {
                    return await selectInstalledAsrModel(fallback.currentModelId, {selectionAlreadyPersisted: true});
                }
                broadcastAsrModelStatus();
                return getPublicAsrModelSnapshot();
            } catch (error) {
                const current = getAsrModelManager().snapshot;
                const currentStillInstalled = current.currentModelId === id
                    && current.models.find((model) => model.id === id)?.state === 'installed';
                if (deletingCurrent && currentStillInstalled && !localAsrEngine) {
                    try {
                        await selectInstalledAsrModel(id, {selectionAlreadyPersisted: true});
                    } catch {}
                }
                throw sanitizeAsrModelError(error);
            }
        });
    });
    ipcMain.handle(IPC_CHANNELS.asr.start, async (event, sampleRate: unknown) => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized ASR request');
        if (!Number.isInteger(sampleRate)) throw new TypeError('ASR sample rate must be an integer');
        assertCurrentAsrModelReady();
        return getAsrSessionCoordinator().start(event.sender as unknown as AsrSessionSender, sampleRate as number);
    });
    ipcMain.handle(IPC_CHANNELS.asr.stop, async (event): Promise<AsrStatus> => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized ASR request');
        return getAsrSessionCoordinator().stop();
    });
    ipcMain.handle(IPC_CHANNELS.asr.getStatus, (event): AsrStatus => {
        if (!isOverlayWebContents(event.sender)) throw new Error('Unauthorized ASR request');
        return getLocalAsrStatus();
    });

    ipcHandlersRegistered = true;
}

function broadcastOverlayWindowError(message: string): void {
    for (const win of getLiveOverlayWindows()) win.webContents.send(IPC_CHANNELS.overlay.windowError, message);
}

function configureOverlayWindow(win: BrowserWindow, manager: WindowPrivacyManager): void {
    manager.registerWindow(win);
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('did-finish-load', () => {
        manager.reassertCaptureProtection();
        broadcastPrivacyStatus();
        broadcastOverlaySnapshot();
        broadcastWindowState();
        broadcastAsrModelStatus();
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        broadcastOverlayWindowError(`Overlay renderer exited: ${details.reason}`);
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        broadcastOverlayWindowError(`Overlay renderer failed to load (${errorCode}): ${errorDescription}`);
    });
    win.on('show', () => {
        manager.reassertCaptureProtection();
        broadcastWindowState();
    });
    win.on('hide', broadcastWindowState);
}

function configureSettingsWindow(win: BrowserWindow, manager: WindowPrivacyManager): void {
    manager.registerWindow(win);
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('did-finish-load', () => {
        manager.reassertCaptureProtection();
        broadcastPrivacyStatus();
        broadcastAsrModelStatus();
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        console.error('[desktop] settings renderer exited:', details.reason);
        if (settingsWindowController?.getWindow() === win) settingsWindowController.close();
    });
    win.on('show', () => {
        manager.reassertCaptureProtection();
        broadcastPrivacyStatus();
        broadcastAsrModelStatus();
    });
}

function onOverlayWindowClosed(): void {
    const controller = overlayController;
    overlayController = null;
    mainWindow = null;
    controller?.dispose();
    disposeAsr();
}

function createMainWindow(): void {
    if (overlayController) return;
    const manager = getPrivacyManager();
    const workArea = screen?.getPrimaryDisplay?.()?.workArea ?? {x: 0, y: 0, width: 1920, height: 1080};
    const controller = createOverlayWindowController({
        BrowserWindow: BrowserWindow as unknown as new (options: Record<string, unknown>) => BrowserWindowLike,
        rendererRoot: path.join(__dirname, '..', 'renderer'),
        windowIconPath: path.join(__dirname, '..', '..', 'renderer', 'favicon.ico'),
        initialCapsuleBounds: {
            x: Math.round(workArea.x + (workArea.width - CAPSULE_BOUNDS.width) / 2),
            y: workArea.y + 24,
        },
        preloadPath: path.join(__dirname, '..', 'preload', 'index.js'),
        onWindowCreated: (window) => {
            const browserWindow = window as unknown as BrowserWindow;
            if (!mainWindow) mainWindow = browserWindow;
            configureOverlayWindow(browserWindow, manager);
            browserWindow.on('closed', onOverlayWindowClosed);
        },
    });
    overlayController = controller;
    void controller.initialize().then(() => {
        if (overlayController !== controller) return;
        const overlay = controller.getWindow() as unknown as BrowserWindow | null;
        if (!overlay) throw new Error('Overlay window failed to initialize');
        mainWindow = overlay;
        broadcastPrivacyStatus();
        broadcastOverlaySnapshot();
        broadcastWindowState();
        broadcastAsrModelStatus();
        if (secondInstancePending) {
            secondInstancePending = false;
            if (overlay.isMinimized()) overlay.restore();
            overlay.show();
            overlay.focus();
            broadcastWindowState();
        }
    }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Overlay initialization failed';
        console.error('[desktop] overlay initialization failed:', error);
        broadcastOverlayWindowError(message);
        onOverlayWindowClosed();
    });
}

async function startApplication(): Promise<void> {
    privacyManager = new WindowPrivacyManager({onStatus: broadcastPrivacyStatus});
    modelConnectionStore = new ModelConnectionStore({
        safeStorage,
        settingsPath: path.join(app.getPath('userData'), 'model-connection.json'),
    });
    audioInputSettingsStore = new AudioInputSettingsStore({
        platform: process.platform,
        settingsPath: path.join(app.getPath('userData'), 'audio-input.json'),
    });
    await initializeAsr();
    settingsWindowController = createSettingsWindowController({
        BrowserWindow: BrowserWindow as unknown as SettingsBrowserWindowConstructor,
        rendererRoot: path.join(__dirname, '..', 'renderer'),
        windowIconPath: path.join(__dirname, '..', '..', 'renderer', 'favicon.ico'),
        preloadPath: path.join(__dirname, '..', 'preload', 'settings.js'),
        onWindowCreated: (window) => configureSettingsWindow(window as BrowserWindow, getPrivacyManager()),
    });
    registerIpcHandlers();
    configureDisplayMediaCapture();
    createMainWindow();

    globalShortcut.register('CommandOrControl+Shift+P', () => {
        const manager = getPrivacyManager();
        manager.setCaptureProtection(!manager.getStatus().captureProtectionEnabled);
    });
    globalShortcut.register('CommandOrControl+Shift+M', () => {
        const visible = getLiveOverlayWindows().some((win) => win.isVisible());
        setOverlayVisibility(!visible);
    });
}

if (hasSingleInstanceLock) {
    app.whenReady().then(startApplication).catch((error: unknown) => {
        console.error('[desktop] startup failed:', error);
        disposeAsr();
        app.quit();
    });
}

app.on('activate', () => {
    if (!overlayController || !getLiveOverlayWindows()[0]) {
        createMainWindow();
        if (!localAsrEngine && asrModelManager) {
            const {currentModelId, models} = asrModelManager.snapshot;
            if (models.find((model) => model.id === currentModelId)?.state === 'installed') {
                void selectInstalledAsrModel(currentModelId, {selectionAlreadyPersisted: true}).catch(() => undefined);
            }
        }
    }
});

app.on('before-quit', () => {
    settingsWindowController?.dispose();
    settingsWindowController = null;
    disposeAsr();
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
