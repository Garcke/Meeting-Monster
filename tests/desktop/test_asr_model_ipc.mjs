import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainPath = path.join(projectRoot, 'desktop', 'dist', 'main', 'main.js');
const read = (...parts) => fs.readFileSync(path.join(projectRoot, ...parts), 'utf8');
const PARA = 'streaming-paraformer-bilingual-zh-en';
const ZIP = 'streaming-zipformer-zh-int8-2025-06-30';

function handlerSource(source, channel) {
    const marker = `ipcMain.handle(IPC_CHANNELS.asrModels.${channel}`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing ${channel} handler`);
    const next = source.indexOf('ipcMain.handle(', start + marker.length);
    return source.slice(start, next === -1 ? source.length : next);
}

async function loadMainHarness() {
    const handlers = new Map();
    const appListeners = new Map();
    const descriptors = [
        {id: PARA, label: 'Paraformer', languages: ['zh', 'en'], description: 'Bilingual', estimatedBytes: 10, supportsHotwords: false},
        {id: ZIP, label: 'Zipformer', languages: ['zh'], description: 'Chinese', estimatedBytes: 20, supportsHotwords: false},
    ];

    class FakeAsrModelManager {
        constructor() {
            this.currentModelId = PARA;
            this.models = [
                {id: PARA, state: 'installed', downloadedBytes: 10, totalBytes: 10},
                {id: ZIP, state: 'not-downloaded', downloadedBytes: 0, totalBytes: 20},
            ];
            this.listeners = new Set();
        }
        get snapshot() {
            return {currentModelId: this.currentModelId, models: this.models.map((model) => ({...model}))};
        }
        subscribe(listener) { this.listeners.add(listener); listener(this.snapshot); return () => this.listeners.delete(listener); }
        emit() { for (const listener of this.listeners) listener(this.snapshot); }
        async initialize() { this.emit(); return this.snapshot; }
        async download(id) {
            const model = this.models.find((item) => item.id === id);
            model.state = 'not-downloaded'; model.downloadedBytes = 0;
            throw new Error('Download cancelled');
        }
        async selectModel(id) { this.currentModelId = id; this.emit(); return this.snapshot; }
        getModelDirectory(id) { return `C:/models/${id}`; }
        cancel() { return false; }
    }

    class FakeLocalAsrEngine {
        static instances = [];
        static failNextLoad = false;
        constructor() {
            this.disposed = false;
            this.startCalls = 0;
            this.status = {state: 'idle'};
            FakeLocalAsrEngine.instances.push(this);
        }
        async load() {
            if (FakeLocalAsrEngine.failNextLoad) {
                FakeLocalAsrEngine.failNextLoad = false;
                throw new Error('private native load detail');
            }
            this.status = {state: 'ready'};
            return this.getStatus();
        }
        onResult(listener) { this.listener = listener; return () => { this.listener = undefined; }; }
        getStatus() { return {...this.status}; }
        async start() {
            if (this.disposed) throw new Error('disposed engine');
            this.startCalls += 1;
            this.status = {state: 'recording'};
            return this.getStatus();
        }
        acceptPcm() {}
        async stop() { this.status = {state: 'idle'}; return this.getStatus(); }
        dispose() { this.disposed = true; this.status = {state: 'idle'}; }
    }

    class FakeAsrSessionCoordinator {
        constructor(options) { this.options = options; this.active = false; this.owner = null; }
        isActive() { return this.active; }
        getOwner() { return this.owner; }
        async start(sender, sampleRate) {
            this.active = true;
            this.owner = sender;
            return this.options.startEngine(sampleRate);
        }
        async stop() { this.active = false; this.owner = null; return this.options.stopEngine(); }
        endSession() { this.active = false; this.owner = null; }
    }

    class FakeBrowserWindow {
        static windows = [];
        constructor(options) {
            this.bounds = {x: 0, y: 0, width: options.width, height: options.height};
            this.destroyed = false;
            this.visible = false;
            this.sent = [];
            this.webContents = {
                isDestroyed: () => false,
                send: (...args) => this.sent.push(args),
                postMessage: () => {},
                setWindowOpenHandler: () => {},
                on: () => {},
            };
            FakeBrowserWindow.windows.push(this);
        }
        static fromWebContents(sender) { return FakeBrowserWindow.windows.find((window) => window.webContents === sender) ?? null; }
        static getAllWindows() { return [...FakeBrowserWindow.windows]; }
        isDestroyed() { return this.destroyed; }
        isVisible() { return this.visible; }
        getBounds() { return {...this.bounds}; }
        setBounds(bounds) { this.bounds = {...bounds}; }
        show() { this.visible = true; }
        hide() { this.visible = false; }
        on() {}
        once() {}
        loadFile() { return Promise.resolve(); }
    }

    class FakePrivacyManager {
        registerWindow() {}
        reassertCaptureProtection() {}
        setCaptureProtection() {}
        getStatus() { return {captureProtection: 'protected', captureProtectionEnabled: true, platform: 'win32', windowCount: 1}; }
    }

    const electron = {
        app: {
            isPackaged: false,
            getPath: () => 'C:/user-data',
            whenReady: () => Promise.resolve(),
            on: (event, listener) => appListeners.set(event, listener),
            requestSingleInstanceLock: () => true,
            quit: () => {},
        },
        BrowserWindow: FakeBrowserWindow,
        globalShortcut: {register: () => true, unregisterAll: () => {}},
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: (channel) => handlers.delete(channel),
        },
        MessageChannelMain: class {},
        safeStorage: {},
        session: {defaultSession: {setDisplayMediaRequestHandler: () => {}}},
        desktopCapturer: {getSources: async () => []},
        webContents: {fromFrame: () => null},
    };
    const catalog = {
        getAsrModelCatalog: () => descriptors,
        getAsrModel: (id) => {
            const descriptor = descriptors.find((model) => model.id === id);
            if (!descriptor) throw new Error('Unknown ASR model');
            return descriptor;
        },
        toPublicAsrModelDescriptor: (descriptor, installedState, isCurrent) => ({
            ...descriptor,
            installedState,
            isCurrent,
        }),
    };
    const originalLoad = Module._load;
    Module._load = (request, parent, isMain) => {
        if (request === 'electron') return electron;
        if (request === './asr-model-manager') return {AsrModelManager: FakeAsrModelManager};
        if (request === './asr-model-catalog') return catalog;
        if (request === './local-asr-engine') return {LocalAsrEngine: FakeLocalAsrEngine};
        if (request === './asr-session-coordinator') return {AsrSessionCoordinator: FakeAsrSessionCoordinator};
        if (request === './model-connection-settings') {
            return {ModelConnectionStore: class {}, validateModelConnection: (value) => value};
        }
        if (request === './privacy-manager') return {WindowPrivacyManager: FakePrivacyManager};
        if (request === './remote-api-client') {
            return {RemoteApiClient: class {}, validateModelSelectionInput: (value) => value};
        }
        if (request === 'sherpa-onnx-node') return {};
        return originalLoad(request, parent, isMain);
    };
    try {
        delete require.cache[mainPath];
        require(mainPath);
        for (let attempt = 0; attempt < 20 && !handlers.has('asr-models:select'); attempt += 1) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    } finally {
        Module._load = originalLoad;
    }
    assert.equal(handlers.has('asr-models:select'), true, 'main IPC initialization did not complete');
    const window = FakeBrowserWindow.windows[0];
    return {
        handlers,
        window,
        FakeLocalAsrEngine,
        sent: window.sent,
        cleanup() {
            appListeners.get('before-quit')?.();
            delete require.cache[mainPath];
        },
    };
}

test('failed reselect of the loaded current model preserves its ready engine and recording gate', async () => {
    const harness = await loadMainHarness();
    try {
        const event = {sender: harness.window.webContents};
        const previousEngine = harness.FakeLocalAsrEngine.instances[0];
        harness.FakeLocalAsrEngine.failNextLoad = true;

        await assert.rejects(
            harness.handlers.get('asr-models:select')(event, PARA),
            /ASR model operation failed/,
        );

        const snapshot = harness.handlers.get('asr-models:list')(event);
        assert.equal(snapshot.currentModelId, PARA);
        assert.equal(snapshot.models.find((model) => model.id === PARA).installedState, 'ready');
        assert.equal(previousEngine.disposed, false);
        assert.equal(harness.FakeLocalAsrEngine.instances[1].disposed, true);
        await assert.doesNotReject(harness.handlers.get('asr:start')(event, 16000));
        assert.equal(previousEngine.startCalls, 1);
    } finally {
        harness.cleanup();
    }
});

test('cancelled ASR model download returns a snapshot without publishing runtime failure', async () => {
    const harness = await loadMainHarness();
    try {
        const event = {sender: harness.window.webContents};
        const result = await harness.handlers.get('asr-models:download')(event, PARA);
        assert.equal(result.models.find((model) => model.id === PARA).installedState, 'not-downloaded');
        assert.equal(result.models.find((model) => model.id === PARA).errorMessage, undefined);
        assert.equal(harness.sent.some(([, snapshot]) => snapshot?.models?.some((model) => model.installedState === 'failed')), false);
    } finally {
        harness.cleanup();
    }
});

test('ASR model IPC accepts only fixed model IDs from the authorized main window', () => {
    const source = read('desktop', 'src', 'main', 'main.ts');

    assert.match(source, /function requireAsrModelId\(value: unknown\): AsrModelId/);
    assert.match(source, /Unknown ASR model/);
    for (const channel of ['list', 'select', 'download', 'cancel', 'delete']) {
        const handler = handlerSource(source, channel);
        assert.match(handler, /if \(!isAuthorizedSender\(event\)\) throw new Error\('Unauthorized ASR model request'\)/);
        if (channel !== 'list') {
            assert.match(handler, /modelId: unknown/);
            assert.match(handler, /requireAsrModelId\(modelId\)/);
        }
        assert.doesNotMatch(handler, /downloadUrl|localPath|modelPath|sha256|checksum|event[^\n]*path|path[^\n]*event/i);
    }
});

test('ASR model snapshots merge fixed public catalog metadata with progress only', () => {
    const source = read('desktop', 'src', 'main', 'main.ts');

    assert.match(source, /function getPublicAsrModelSnapshot\(\): AsrModelSnapshot/);
    assert.match(source, /getAsrModelCatalog\(\)\.map/);
    assert.match(source, /toPublicAsrModelDescriptor\(/);
    assert.match(source, /downloadedBytes:/);
    assert.match(source, /totalBytes:/);
    assert.match(source, /errorMessage/);
    assert.match(source, /function broadcastAsrModelStatus\(\): void[\s\S]*getLiveOverlayWindows\(\)[\s\S]*IPC_CHANNELS\.asrModels\.status/);
});

test('model selection is recording-gated and swaps engines transactionally', () => {
    const source = read('desktop', 'src', 'main', 'main.ts');
    const select = handlerSource(source, 'select');

    assert.match(select, /assertAsrModelMutationAllowed\(\)/);
    assert.match(source, /function assertAsrModelMutationAllowed\(\)[\s\S]*\.isActive\(\)[\s\S]*Cannot change ASR models while recording/);
    assert.match(source, /const previousEngine = localAsrEngine/);
    assert.match(source, /const candidateEngine = createLocalAsrEngine\(\)/);
    assert.match(source, /await candidateEngine\.load\(id\)[\s\S]*await manager\.selectModel\(id\)/);
    assert.match(source, /previousEngine\?\.dispose\(\)/);
    assert.match(source, /candidateEngine\.dispose\(\)[\s\S]*throw new Error\('ASR model operation failed'\)/);
});

test('download, cancel, and delete keep explicit fixed-ID semantics', () => {
    const source = read('desktop', 'src', 'main', 'main.ts');
    const download = handlerSource(source, 'download');
    const cancel = handlerSource(source, 'cancel');
    const remove = handlerSource(source, 'delete');

    assert.match(download, /assertAsrModelMutationAllowed\(\)/);
    assert.match(download, /await getAsrModelManager\(\)\.download\(id\)/);
    assert.match(download, /await selectInstalledAsrModel\(id/);
    assert.match(cancel, /getAsrModelManager\(\)\.cancel\(id\)/);
    assert.doesNotMatch(cancel, /assertAsrModelMutationAllowed/);
    assert.match(remove, /assertAsrModelMutationAllowed\(\)/);
    assert.match(remove, /releaseCurrentAsrEngineForDelete\(id\)/);
    assert.match(remove, /await getAsrModelManager\(\)\.delete\(id\)/);
    assert.match(remove, /catch \(error\)[\s\S]*throw sanitizeAsrModelError\(error\)/);
    assert.doesNotMatch(remove, /\.download\(/);
});

test('startup restores only an already-installed current model and never auto-downloads', () => {
    const source = read('desktop', 'src', 'main', 'main.ts');
    const initialize = source.match(/async function initializeAsr\(\): Promise<void> \{([\s\S]*?)\n\}/)?.[1] ?? '';

    assert.match(initialize, /await .*\.initialize\(\)/);
    assert.match(initialize, /currentModelId/);
    assert.match(initialize, /state === 'installed'/);
    assert.match(initialize, /await selectInstalledAsrModel\(/);
    assert.doesNotMatch(initialize, /\.download\(/);
});

test('local recording requires a ready installed current model and uses the local coordinator lifecycle', () => {
    const source = read('desktop', 'src', 'main', 'main.ts');
    const start = source.slice(
        source.indexOf('ipcMain.handle(IPC_CHANNELS.asr.start'),
        source.indexOf('ipcMain.handle(IPC_CHANNELS.asr.stop'),
    );
    const stop = source.slice(
        source.indexOf('ipcMain.handle(IPC_CHANNELS.asr.stop'),
        source.indexOf('ipcMain.handle(IPC_CHANNELS.asr.getStatus'),
    );

    assert.match(start, /assertCurrentAsrModelReady\(\)/);
    assert.match(start, /getAsrSessionCoordinator\(\)\.start/);
    assert.match(stop, /getAsrSessionCoordinator\(\)\.stop\(\)/);
    assert.match(source, /function assertCurrentAsrModelReady\(\)[\s\S]*installed[\s\S]*ready/);
    assert.match(source, /function disposeAsr\(\)[\s\S]*cancel[\s\S]*\.dispose\(\)/);
    assert.doesNotMatch(source, /RemoteAsrClient|remote-asr-client|new globalThis\.WebSocket|\/ws\/asr/);
});
