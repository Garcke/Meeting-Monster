import test from 'node:test';
import assert from 'node:assert/strict';
import Module, {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const preloadPath = path.join(projectRoot, 'desktop', 'dist', 'preload', 'index.js');

class FakePort {
    constructor() {
        this.closed = false;
        this.messages = [];
    }

    postMessage(data, transfer) {
        this.messages.push({data, transfer});
    }

    close() {
        this.closed = true;
    }
}

function loadPreload() {
    const listeners = new Map();
    const invocations = [];
    let invoke = async () => ({state: 'recording'});
    let exposed;
    const ipcRenderer = {
        on(channel, listener) {
            listeners.set(channel, listener);
            return this;
        },
        removeListener(channel, listener) {
            if (listeners.get(channel) === listener) listeners.delete(channel);
            return this;
        },
        invoke(...args) {
            invocations.push(args);
            return invoke(...args);
        },
    };
    const originalLoad = Module._load;
    Module._load = (request, parent, isMain) => request === 'electron'
        ? {contextBridge: {exposeInMainWorld: (_name, api) => { exposed = api; }}, ipcRenderer}
        : originalLoad(request, parent, isMain);
    try {
        delete require.cache[preloadPath];
        require(preloadPath);
    } finally {
        Module._load = originalLoad;
    }
    return {
        api: exposed,
        invocations,
        setInvoke(handler) { invoke = handler; },
        deliver(port) { listeners.get('asr:port')({ports: [port]}); },
        deliverMissingPort() { listeners.get('asr:port')({ports: []}); },
        deliverStatus(status) { listeners.get('asr:status')({}, status); },
        deliverModelStatus(snapshot) { listeners.get('asr-models:status')({}, snapshot); },
        deliverOverlaySnapshot(snapshot) { listeners.get('overlay:snapshot')({}, snapshot); },
        deliverOverlayWindowError(error) { listeners.get('overlay:window-error')({}, error); },
    };
}

test('preload exposes fixed ASR model commands separately from remote AI model controls', async () => {
    const preload = loadPreload();
    const modelId = 'streaming-paraformer-bilingual-zh-en';
    const snapshot = {currentModelId: modelId, models: []};
    preload.setInvoke(async (channel) => channel === 'asr-models:list' ? snapshot : undefined);

    assert.deepEqual(await preload.api.asrModels.list(), snapshot);
    await preload.api.asrModels.select(modelId);
    await preload.api.asrModels.download(modelId);
    await preload.api.asrModels.cancel(modelId);
    await preload.api.asrModels.delete(modelId);

    assert.deepEqual(preload.invocations, [
        ['asr-models:list'],
        ['asr-models:select', modelId],
        ['asr-models:download', modelId],
        ['asr-models:cancel', modelId],
        ['asr-models:delete', modelId],
    ]);
    assert.deepEqual(Object.keys(preload.api.asrModels).sort(), ['cancel', 'delete', 'download', 'list', 'onStatus', 'select']);
    assert.equal(Object.hasOwn(preload.api.models, 'download'), false);

    let received;
    preload.api.asrModels.onStatus((value) => { received = value; });
    preload.deliverModelStatus(snapshot);
    assert.deepEqual(received, snapshot);
});

test('preload exposes only the typed overlay commands and removable overlay subscriptions', async () => {
    const preload = loadPreload();
    const snapshot = {target: 'workspace', phase: 'visible', revision: 2};
    preload.setInvoke(async (channel, intent) => {
        if (channel === 'overlay:intent') return {...snapshot, intent};
        if (channel === 'overlay:get-snapshot') return snapshot;
        if (channel === 'overlay:renderer-ready' || channel === 'overlay:animation-finished') return {...snapshot, revision: intent};
        return undefined;
    });

    assert.deepEqual(await preload.api.overlay.intent({type: 'toggle-workspace'}), {
        ...snapshot,
        intent: {type: 'toggle-workspace'},
    });
    assert.deepEqual(await preload.api.overlay.getSnapshot(), snapshot);
    assert.deepEqual(await preload.api.overlay.panelReady(2), {...snapshot, revision: 2});
    assert.deepEqual(await preload.api.overlay.animationFinished(2), {...snapshot, revision: 2});
    assert.deepEqual(preload.invocations, [
        ['overlay:intent', {type: 'toggle-workspace'}],
        ['overlay:get-snapshot'],
        ['overlay:renderer-ready', 2],
        ['overlay:animation-finished', 2],
    ]);
    assert.deepEqual(Object.keys(preload.api.overlay).sort(), ['animationFinished', 'getSnapshot', 'intent', 'onSnapshot', 'onWindowError', 'panelReady', 'rendererReady']);

    let receivedSnapshot;
    let receivedError;
    const unsubscribeSnapshot = preload.api.overlay.onSnapshot((value) => { receivedSnapshot = value; });
    const unsubscribeError = preload.api.overlay.onWindowError((value) => { receivedError = value; });
    preload.deliverOverlaySnapshot(snapshot);
    preload.deliverOverlayWindowError('Window failed to show');
    assert.deepEqual(receivedSnapshot, snapshot);
    assert.equal(receivedError, 'Window failed to show');

    unsubscribeSnapshot();
    unsubscribeSnapshot();
    unsubscribeError();
    unsubscribeError();
});

test('preload rejects invalid PCM chunks before reading a missing port', () => {
    const preload = loadPreload();

    assert.throws(() => preload.api.asr.writePcm(null), /non-empty Int16Array/);
    assert.throws(() => preload.api.asr.writePcm(new Int16Array()), /non-empty Int16Array/);
});

test('preload waits for a PCM port that arrives after the ASR start IPC resolves', async () => {
    const preload = loadPreload();
    const port = new FakePort();
    let resolveStart;
    preload.setInvoke(() => new Promise((resolve) => {
        resolveStart = () => resolve({state: 'recording'});
    }));

    const startPromise = preload.api.asr.start(16000);
    resolveStart();
    await new Promise((resolve) => setImmediate(resolve));
    preload.deliver(port);

    assert.deepEqual(await startPromise, {state: 'recording'});
    preload.api.asr.writePcm(new Int16Array([1]));
    assert.equal(port.messages.length, 1);
});

test('preload rejects a pending start and reports a recoverable status when the ASR port is missing', async () => {
    const preload = loadPreload();
    let received;
    preload.api.asr.onStatus((status) => { received = status; });
    preload.setInvoke(async () => ({state: 'recording'}));

    const startPromise = preload.api.asr.start(16000);
    await new Promise((resolve) => setImmediate(resolve));
    preload.deliverMissingPort();

    assert.deepEqual(received, {state: 'error', message: 'ASR PCM channel is unavailable'});
    await assert.rejects(startPromise, /ASR PCM channel is unavailable/);
});

test('preload sends PCM as a cloneable typed array instead of transferring an ArrayBuffer', async () => {
    const preload = loadPreload();
    const port = new FakePort();
    preload.deliver(port);
    await preload.api.asr.start(16000);

    preload.api.asr.writePcm(new Int16Array([1, 2]));

    assert.equal(port.messages.length, 1);
    assert.deepEqual(Array.from(port.messages[0].data), [1, 2]);
    assert.equal(port.messages[0].data.constructor, Int16Array);
    assert.equal(port.messages[0].transfer, undefined);
});

test('preload closes the private PCM port before delivering a remote ASR error status', async () => {
    const preload = loadPreload();
    const port = new FakePort();
    preload.deliver(port);
    await preload.api.asr.start(16000);
    let received;
    preload.api.asr.onStatus((status) => {
        received = status;
        assert.equal(port.closed, true);
    });

    preload.deliverStatus({state: 'error'});

    assert.deepEqual(received, {state: 'error'});
    assert.throws(() => preload.api.asr.writePcm(new Int16Array([1])), /ASR is not recording/);
});

test('preload closes the private PCM port before delivering a remote ASR idle status', async () => {
    const preload = loadPreload();
    const port = new FakePort();
    preload.deliver(port);
    await preload.api.asr.start(16000);
    let received;
    preload.api.asr.onStatus((status) => {
        received = status;
        assert.equal(port.closed, true);
    });

    preload.deliverStatus({state: 'idle'});

    assert.deepEqual(received, {state: 'idle'});
    assert.throws(() => preload.api.asr.writePcm(new Int16Array([1])), /ASR is not recording/);
});

test('preload closes the private PCM port after a successful stop', async () => {
    const preload = loadPreload();
    const port = new FakePort();
    preload.deliver(port);
    await preload.api.asr.start(16000);
    preload.api.asr.writePcm(new Int16Array([1]));
    preload.setInvoke(async (channel) => channel === 'asr:stop' ? {state: 'idle'} : {state: 'recording'});

    await preload.api.asr.stop();

    assert.equal(port.closed, true);
    assert.throws(() => preload.api.asr.writePcm(new Int16Array([1])), /ASR is not recording/);
    assert.deepEqual(Object.keys(preload.api.asr).sort(), ['getStatus', 'onResult', 'onStatus', 'start', 'stop', 'writePcm']);
});

test('preload closes the private PCM port after start or stop rejects', async () => {
    const startFailure = loadPreload();
    const startPort = new FakePort();
    startFailure.deliver(startPort);
    startFailure.setInvoke(async () => { throw new Error('start failed'); });

    await assert.rejects(startFailure.api.asr.start(16000), /start failed/);
    assert.equal(startPort.closed, true);
    assert.throws(() => startFailure.api.asr.writePcm(new Int16Array([1])), /ASR is not recording/);

    const stopFailure = loadPreload();
    const stopPort = new FakePort();
    stopFailure.deliver(stopPort);
    await stopFailure.api.asr.start(16000);
    stopFailure.setInvoke(async (channel) => {
        if (channel === 'asr:stop') throw new Error('stop failed');
        return {state: 'recording'};
    });

    await assert.rejects(stopFailure.api.asr.stop(), /stop failed/);
    assert.equal(stopPort.closed, true);
    assert.throws(() => stopFailure.api.asr.writePcm(new Int16Array([1])), /ASR is not recording/);
});
