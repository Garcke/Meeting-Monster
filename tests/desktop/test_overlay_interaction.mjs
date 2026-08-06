import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {createOverlayWindowController} from '../../desktop/dist/main/overlay-window-controller.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronExe = path.join(projectRoot, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
const harnessPath = path.join(projectRoot, 'tests', 'desktop', 'settings-interaction-electron.cjs');
const contractsSource = fs.readFileSync(path.join(projectRoot, 'desktop', 'src', 'shared', 'contracts.ts'), 'utf8');
const preloadSource = fs.readFileSync(path.join(projectRoot, 'desktop', 'src', 'preload', 'index.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(projectRoot, 'desktop', 'src', 'main', 'main.ts'), 'utf8');
const electronInteractionTimeoutMs = 25_000;

function terminateElectronProcessTree(child) {
    if (!child.pid) {
        child.kill?.('SIGKILL');
        return Promise.resolve();
    }
    if (process.platform !== 'win32') {
        child.kill('SIGKILL');
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const terminator = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            windowsHide: true,
            stdio: 'ignore',
        });
        const cleanup = () => {
            terminator.off('error', onError);
            terminator.off('exit', onExit);
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onExit = (code) => {
            cleanup();
            if (code === 0) resolve();
            else reject(new Error(`taskkill exited with code ${code}`));
        };
        terminator.once('error', onError);
        terminator.once('exit', onExit);
    });
}

function runElectronInteraction({
    spawnElectron = spawn,
    terminateProcessTree = terminateElectronProcessTree,
    timeoutMs = electronInteractionTimeoutMs,
} = {}) {
    return new Promise((resolve, reject) => {
        const child = spawnElectron(electronExe, [harnessPath], {
            cwd: projectRoot,
            env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: 'false'},
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let watchdog;
        const onStdout = (chunk) => { stdout += chunk; };
        const onStderr = (chunk) => { stderr += chunk; };
        const cleanup = () => {
            clearTimeout(watchdog);
            child.stdout.off('data', onStdout);
            child.stderr.off('data', onStderr);
            child.off('error', onError);
            child.off('exit', onExit);
        };
        const onError = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };
        const onExit = (code, signal) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({code, signal, stdout, stderr});
        };
        child.stdout.on('data', onStdout);
        child.stderr.on('data', onStderr);
        child.once('error', onError);
        child.once('exit', onExit);
        watchdog = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            Promise.resolve()
                .then(() => terminateProcessTree(child))
                .then(
                    () => reject(new Error(`Electron settings interaction timed out after ${timeoutMs}ms`)),
                    (error) => reject(new Error(
                        `Electron settings interaction timed out after ${timeoutMs}ms and process-tree termination failed: ${String(error)}`,
                        {cause: error},
                    )),
                );
        }, timeoutMs);
    });
}

function createFakeElectronChild() {
    const child = new EventEmitter();
    child.pid = 4321;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
}

test('Electron interaction watchdog terminates the child tree and removes listeners before rejecting', async () => {
    const child = createFakeElectronChild();
    let terminateCalls = 0;

    await assert.rejects(
        runElectronInteraction({
            spawnElectron: () => child,
            terminateProcessTree: async () => { terminateCalls += 1; },
            timeoutMs: 5,
        }),
        /timed out/i,
    );
    assert.equal(terminateCalls, 1);
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
});

test('Electron interaction exit clears the watchdog and child listeners', async () => {
    const child = createFakeElectronChild();
    let terminateCalls = 0;
    queueMicrotask(() => child.emit('exit', 0, null));

    const result = await runElectronInteraction({
        spawnElectron: () => child,
        terminateProcessTree: async () => { terminateCalls += 1; },
        timeoutMs: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(result, {code: 0, signal: null, stdout: '', stderr: ''});
    assert.equal(terminateCalls, 0);
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
});

test('Electron interaction error clears the watchdog and child listeners', async () => {
    const child = createFakeElectronChild();
    const failure = new Error('spawn failed');
    let terminateCalls = 0;
    queueMicrotask(() => child.emit('error', failure));

    await assert.rejects(
        runElectronInteraction({
            spawnElectron: () => child,
            terminateProcessTree: async () => { terminateCalls += 1; },
            timeoutMs: 5,
        }),
        failure,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(terminateCalls, 0);
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
});

test('overlay controller readiness and renderer error channels are wired end-to-end', () => {
    assert.match(contractsSource, /rendererReady: 'overlay:renderer-ready'/);
    assert.match(contractsSource, /animationFinished: 'overlay:animation-finished'/);
    assert.match(contractsSource, /windowError: 'overlay:window-error'/);
    assert.match(preloadSource, /rendererReady: \(revision\) => ipcRenderer\.invoke\(IPC_CHANNELS\.overlay\.rendererReady, revision\)/);
    assert.match(preloadSource, /animationFinished: \(revision\) => ipcRenderer\.invoke\(IPC_CHANNELS\.overlay\.animationFinished, revision\)/);
    assert.match(mainSource, /ipcMain\.handle\(IPC_CHANNELS\.overlay\.rendererReady/);
    assert.match(mainSource, /ipcMain\.handle\(IPC_CHANNELS\.overlay\.animationFinished/);
    assert.match(mainSource, /webContents\.send\(IPC_CHANNELS\.overlay\.windowError/);
});

test('workspace open and close keep fixed native bounds while stale animation revisions preserve the panel shape', async () => {
    class FakeWindow extends EventEmitter {
        constructor(options) { super(); this.bounds = {...options.bounds}; this.setBoundsCalls = []; this.setShapeCalls = []; this.destroyed = false; }
        getBounds() { return {...this.bounds}; }
        setBounds(bounds, animate) { this.setBoundsCalls.push({bounds: {...bounds}, animate}); this.bounds = {...this.bounds, ...bounds}; }
        setShape(rects) { this.setShapeCalls.push(rects.map((rect) => ({...rect}))); }
        show() {}
        hide() {}
        isDestroyed() { return this.destroyed; }
        loadFile(filePath) { this.loadedFile = filePath; return Promise.resolve(); }
    }
    const controller = createOverlayWindowController({
        BrowserWindow: FakeWindow,
        rendererRoot: 'dist/renderer',
        windowIconPath: path.join('renderer', 'favicon.ico'),
        initialCapsuleBounds: {x: 220, y: 120},
    });
    await controller.initialize();
    const window = controller.getWindow();
    await controller.dispatch({type: 'toggle-workspace'});
    assert.deepEqual(window.getBounds(), {x: 34, y: 120, width: 648, height: 520});
    assert.equal(window.setBoundsCalls.length, 0);
    assert.deepEqual(window.setShapeCalls.at(-1), [
        {x: 186, y: 0, width: 276, height: 56},
        {x: 0, y: 70, width: 648, height: 450},
    ]);
    await controller.dispatch({type: 'toggle-workspace'});
    await controller.panelAnimationFinished(0);
    assert.deepEqual(window.setShapeCalls.at(-1), [
        {x: 186, y: 0, width: 276, height: 56},
        {x: 0, y: 70, width: 648, height: 450},
    ]);
    await controller.panelAnimationFinished(controller.getSnapshot().revision);
    assert.deepEqual(window.getBounds(), {x: 34, y: 120, width: 648, height: 520});
    assert.equal(window.setBoundsCalls.length, 0);
    assert.deepEqual(window.setShapeCalls.at(-1), [{x: 186, y: 0, width: 276, height: 56}]);
});

test('Electron settings view accepts wheel scrolling and pointer focus', {timeout: 30_000}, async (t) => {
    const result = await runElectronInteraction();
    if (result.stderr.includes('SETTINGS_INTERACTION_ENV_UNAVAILABLE')) {
        t.skip(`Electron could not launch a renderer in this environment: ${result.stderr}`);
        return;
    }
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find((item) => item.startsWith('SETTINGS_INTERACTION_RESULT '));
    assert.ok(line, `Electron harness did not return a result. stdout=${result.stdout} stderr=${result.stderr}`);
    const state = JSON.parse(line.slice('SETTINGS_INTERACTION_RESULT '.length));
    assert.equal(state.modelsVisible, true);
    assert.equal(state.speechVisible, true);
    assert.ok(state.scrollHeight > state.clientHeight, `settings view was not scrollable: ${JSON.stringify(state)}`);
    assert.ok(state.scrolled > 0, `mouse wheel did not scroll settings: ${JSON.stringify(state)}`);
    assert.equal(state.focusedId, 'modelApiKey');
    assert.ok(state.modelOptions >= 2);
    assert.ok(state.asrOptions >= 2);
});
