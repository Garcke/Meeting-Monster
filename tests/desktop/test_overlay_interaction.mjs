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
const harnessPath = path.join(projectRoot, 'tests', 'desktop', 'overlay-interaction-electron.cjs');
const contractsSource = fs.readFileSync(path.join(projectRoot, 'desktop', 'src', 'shared', 'contracts.ts'), 'utf8');
const preloadSource = fs.readFileSync(path.join(projectRoot, 'desktop', 'src', 'preload', 'index.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(projectRoot, 'desktop', 'src', 'main', 'main.ts'), 'utf8');

function runElectronInteraction() {
    return new Promise((resolve, reject) => {
        const child = spawn(electronExe, [harnessPath], {
            cwd: projectRoot,
            env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: 'false'},
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({code, signal, stdout, stderr}));
    });
}

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

test('workspace/settings switching does not append bounds calls and close waits for the current animation revision', async () => {
    class FakeWindow extends EventEmitter {
        constructor(options) { super(); this.bounds = {...options.bounds}; this.setBoundsCalls = []; this.destroyed = false; }
        getBounds() { return {...this.bounds}; }
        setBounds(bounds, animate) { this.setBoundsCalls.push({bounds: {...bounds}, animate}); this.bounds = {...this.bounds, ...bounds}; }
        show() {}
        hide() {}
        isDestroyed() { return this.destroyed; }
        loadFile(filePath) { this.loadedFile = filePath; return Promise.resolve(); }
    }
    const controller = createOverlayWindowController({BrowserWindow: FakeWindow, rendererRoot: 'dist/renderer', initialCapsuleBounds: {x: 220, y: 120}});
    await controller.initialize();
    const window = controller.getWindow();
    await controller.dispatch({type: 'toggle-workspace'});
    const callsAfterWorkspace = window.setBoundsCalls.length;
    await controller.dispatch({type: 'toggle-settings'});
    await controller.dispatch({type: 'toggle-workspace'});
    assert.equal(window.setBoundsCalls.length, callsAfterWorkspace);

    await controller.dispatch({type: 'toggle-workspace'});
    assert.deepEqual(window.getBounds(), {x: 76, y: 120, width: 648, height: 520});
    await controller.panelAnimationFinished(0);
    assert.deepEqual(window.getBounds(), {x: 76, y: 120, width: 648, height: 520});
    await controller.panelAnimationFinished(controller.getSnapshot().revision);
    assert.deepEqual(window.getBounds(), {x: 220, y: 120, width: 360, height: 56});
});

test('Electron settings view accepts wheel scrolling and pointer focus', {timeout: 30_000}, async (t) => {
    if (process.platform !== 'win32' || !fs.existsSync(electronExe)) {
        t.skip(`Electron Windows runtime is unavailable at ${electronExe}`);
        return;
    }
    const result = await runElectronInteraction();
    if (result.stderr.includes('OVERLAY_INTERACTION_ENV_UNAVAILABLE')) {
        t.skip(`Electron could not launch a renderer in this environment: ${result.stderr}`);
        return;
    }
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find((item) => item.startsWith('OVERLAY_INTERACTION_RESULT '));
    assert.ok(line, `Electron harness did not return a result. stdout=${result.stdout} stderr=${result.stderr}`);
    const state = JSON.parse(line.slice('OVERLAY_INTERACTION_RESULT '.length));
    assert.equal(state.settingsVisible, true);
    assert.equal(state.workspaceHidden, true);
    assert.ok(state.scrollHeight > state.clientHeight, `settings view was not scrollable: ${JSON.stringify(state)}`);
    assert.ok(state.scrolled > 0, `mouse wheel did not scroll settings: ${JSON.stringify(state)}`);
    assert.equal(state.focusedId, 'modelApiKey');
    assert.ok(state.modelOptions >= 2);
    assert.ok(state.asrOptions >= 2);
});
