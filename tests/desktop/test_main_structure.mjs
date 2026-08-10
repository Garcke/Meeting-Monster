import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => fs.readFileSync(path.join(projectRoot, ...parts), 'utf8');

const mainSource = () => read('desktop', 'src', 'main', 'main.ts');
const contractsSource = () => read('desktop', 'src', 'shared', 'contracts.ts');
const preloadSource = () => read('desktop', 'src', 'preload', 'index.ts');
const controllerSource = () => read('desktop', 'src', 'main', 'overlay-window-controller.ts');
const coordinatorSource = () => read('desktop', 'src', 'main', 'model-test-coordinator.ts');

function countMatches(source, pattern) {
    return [...source.matchAll(pattern)].length;
}

function ipcHandler(source, channel) {
    const marker = `ipcMain.handle(IPC_CHANNELS.${channel}`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing IPC handler for ${channel}`);
    const next = source.indexOf('ipcMain.handle(', start + marker.length);
    return source.slice(start, next === -1 ? source.length : next);
}

test('desktop has no Python sidecar and loads the single local overlay renderer entry', () => {
    const source = mainSource();
    const controller = controllerSource();

    assert.doesNotMatch(source, /child_process|spawn\(|python|ensureServer|loadURL|fetch\(/i);
    assert.match(source, /createOverlayWindowController\(/);
    assert.match(source, /rendererRoot:\s*path\.join\(__dirname,\s*'\.\.',\s*'renderer'\)/);
    assert.match(controller, /rendererFile\(options\.rendererRoot, 'overlay'\)/);
});

test('main delegates single-window geometry to the overlay controller', () => {
    const source = mainSource();
    const controller = controllerSource();

    assert.match(source, /import \{[^}]*createOverlayWindowController[^}]*CAPSULE_BOUNDS[^}]*\} from '\.\/overlay-window-controller'/s);
    assert.match(source, /let overlayController: OverlayWindowController \| null = null/);
    assert.doesNotMatch(source, /windows\.capsule|windows\.panel/);
    assert.match(controller, /CAPSULE_BOUNDS = \{width: 248, height: 48\}/);
    assert.match(controller, /OVERLAY_BOUNDS = \{width: 648, height: 512\}/);
    assert.match(controller, /PANEL_OFFSET = \{x: -200, y: 62\}/);
    assert.doesNotMatch(controller, /toggle-settings|settings/);
    assert.doesNotMatch(contractsSource(), /toggle-settings|OverlayTarget = 'closed' \| 'workspace' \| 'settings'/);
    assert.doesNotMatch(source, /720\s*,\s*height:\s*520|width:\s*720\s*,\s*height:\s*520|EXPANDED_BOUNDS|getExpandedBounds|getCapsuleBounds|getAnchorFromExpandedBounds|setWindowMode|ProgrammaticBoundsTracker/);
});

test('main preserves secured overlay BrowserWindow options and taskbar policy', () => {
    const source = mainSource();
    const controller = controllerSource();

    const controllerCreation = source.match(/createOverlayWindowController\(\{[\s\S]*?\n\s*\}\);/);
    assert.ok(controllerCreation, 'main should configure the overlay controller in one object-literal call');
    assert.match(
        controllerCreation[0],
        /windowIconPath:\s*path\.join\(__dirname,\s*'\.\.',\s*'\.\.',\s*'renderer',\s*'favicon\.ico'\)/,
    );

    for (const required of [
        /transparent: true/,
        /frame: false/,
        /hasShadow: false/,
        /alwaysOnTop: true/,
        /backgroundColor: '#00000000'/,
        /contextIsolation: true/,
        /nodeIntegration: false/,
        /sandbox: false/,
        /taskbarHidden: true/,
        /skipTaskbar: true/,
        /icon: options\.windowIconPath/,
        /CommandOrControl\+Shift\+P/,
        /CommandOrControl\+\\/,
        /setWindowOpenHandler\(\(\) => \(\{action: 'deny'\}\)\)/,
        /will-navigate[\s\S]*preventDefault\(\)/,
    ]) {
        assert.match(`${source}\n${controller}`, required);
    }
});

test('main IPC registration is sender-authorized and idempotent across legacy and overlay channels', () => {
    const source = mainSource();
    const contracts = contractsSource();
    const preload = preloadSource();

    assert.match(source, /function isOverlayWebContents\(sender: WebContents\)/);
    assert.match(source, /function isApplicationWebContents\(sender: WebContents\)/);
    assert.match(source, /if \(!isOverlayWebContents\(event\.sender\)\) throw new Error\('Unauthorized/);
    assert.match(source, /ipcMain\.removeHandler\(/);
    assert.match(source, /if \(ipcHandlersRegistered\) return/);
    assert.match(
        source,
        /Object\.values\(IPC_CHANNELS\.models\)[\s\S]*?IPC_CHANNELS\.models\.progress[\s\S]*?IPC_CHANNELS\.models\.changed/,
    );

    for (const channel of ['intent', 'getSnapshot', 'rendererReady', 'animationFinished']) {
        assert.match(contracts, new RegExp(`${channel}: 'overlay:`));
        assert.equal(
            countMatches(source, new RegExp(`ipcMain\\.handle\\(IPC_CHANNELS\\.overlay\\.${channel}`, 'g')),
            1,
            `expected one handler for overlay.${channel}`,
        );
        assert.match(preload, new RegExp(`${channel}: .*IPC_CHANNELS\\.overlay\\.${channel}`, 's'));
    }
    assert.match(contracts, /snapshot: 'overlay:snapshot'/);
    assert.match(contracts, /windowError: 'overlay:window-error'/);
});

test('main authorizes each IPC family to the narrowest application window', () => {
    const source = mainSource();

    assert.match(source, /function isOverlayWebContents\(sender: WebContents\)/);
    assert.match(source, /function isSettingsWebContents\(sender: WebContents\)/);
    assert.match(source, /function isApplicationWebContents\(sender: WebContents\)/);
    assert.match(source, /IPC_CHANNELS\.settings\.open[\s\S]*isOverlayWebContents\(event\.sender\)/);
    assert.match(source, /IPC_CHANNELS\.settings\.close[\s\S]*isSettingsWebContents\(event\.sender\)/);
    assert.match(source, /IPC_CHANNELS\.chat\.assist[\s\S]*isOverlayWebContents\(event\.sender\)/);
    assert.match(source, /render-process-gone[\s\S]*settingsWindowController\.close\(\)/);
    assert.doesNotMatch(source.match(/function configureSettingsWindow[\s\S]*?\n\}/)?.[0] ?? '', /disposeAsr/);
    assert.doesNotMatch(source, /BrowserWindow\.getAllWindows\(\)/);

    for (const channel of ['models.save', 'models.test', 'asrModels.select', 'asrModels.download', 'asrModels.cancel', 'asrModels.delete']) {
        assert.match(ipcHandler(source, channel), /isSettingsWebContents\(event\.sender\)/, `${channel} must be settings-only`);
    }
    for (const channel of ['models.list', 'models.getSaved', 'asrModels.list']) {
        assert.match(ipcHandler(source, channel), /isApplicationWebContents\(event\.sender\)/, `${channel} must remain readable from both windows`);
    }
    for (const channel of [
        'window.getState', 'window.setExpanded', 'window.toggleExpanded', 'window.hide', 'window.quit', 'window.show',
        'overlay.intent', 'overlay.getSnapshot', 'overlay.rendererReady', 'overlay.animationFinished',
        'workspaceCommands.dispatch',
        'chat.send', 'chat.assist', 'chat.cancel', 'asr.start', 'asr.stop', 'asr.getStatus',
    ]) {
        assert.match(ipcHandler(source, channel), /isOverlayWebContents\(event\.sender\)/, `${channel} must be overlay-only`);
    }
});

test('main validates and relays workspace commands only from the overlay', () => {
    const source = mainSource();
    const relay = source.match(/function sendWorkspaceCommand[\s\S]*?\n\}/)?.[0] ?? '';

    assert.match(source, /ipcMain\.handle\(IPC_CHANNELS\.workspaceCommands\.dispatch,[\s\S]*isOverlayWebContents\(event\.sender\)/);
    assert.match(source, /function requireWorkspaceCommand\(/);
    assert.match(source, /function sendWorkspaceCommand\(/);
    assert.match(source, /candidate\.type === 'toggle-transcription'[\s\S]*candidate\.type === 'clear-chat'[\s\S]*candidate\.type === 'scroll-chat'[\s\S]*candidate\.direction === 'up'[\s\S]*candidate\.direction === 'down'/);
    assert.match(source, /function sendWorkspaceCommand\([\s\S]*getLiveOverlayWindows\(\)\[0\][\s\S]*IPC_CHANNELS\.workspaceCommands\.event/);
    assert.match(relay, /command\.type === 'clear-chat'[\s\S]*getBackendService\(\)\.resetConversation\(\)[\s\S]*webContents\.send/);
});

test('main applies local web shortcut policy to both windows without global Ctrl+S/R bindings', () => {
    const source = mainSource();
    const policy = source.match(/function configureWebShortcutPolicy[\s\S]*?\n\}/)?.[0] ?? '';
    const overlay = source.match(/function configureOverlayWindow[\s\S]*?\n\}/)?.[0] ?? '';
    const settings = source.match(/function configureSettingsWindow[\s\S]*?\n\}/)?.[0] ?? '';

    assert.match(source, /import \{classifyWebShortcut, type WebShortcutSurface\} from '\.\/web-shortcut-policy'/);
    assert.match(overlay, /configureWebShortcutPolicy\(win, 'overlay'\)/);
    assert.match(settings, /configureWebShortcutPolicy\(win, 'settings'\)/);
    assert.match(policy, /webContents\.on\('before-input-event'/);
    assert.match(policy, /getOverlaySnapshot\(\)\.target === 'workspace'/);
    assert.match(policy, /if \(action === 'allow'\) return;[\s\S]*event\.preventDefault\(\)/);
    assert.match(policy, /action === 'toggle-transcription'[\s\S]*sendWorkspaceCommand\(\{type: 'toggle-transcription'\}\)/);
    assert.match(policy, /action === 'clear-chat'[\s\S]*sendWorkspaceCommand\(\{type: 'clear-chat'\}\)/);
    assert.doesNotMatch(source, /globalShortcut\.register\('CommandOrControl\+S'/);
    assert.doesNotMatch(source, /globalShortcut\.register\('CommandOrControl\+R'/);
});

test('main registers checked global movement, visibility, and workspace scroll controls', () => {
    const source = mainSource();

    assert.match(source, /function registerGlobalShortcut\(accelerator: string, callback: \(\) => void\): void/);
    assert.match(source, /globalShortcut\.register\(accelerator, callback\)[\s\S]*console\.warn\(`\[desktop\] global shortcut unavailable: \$\{accelerator\}`\)/);
    for (const accelerator of [
        'CommandOrControl+Shift+P',
        'CommandOrControl+\\',
        'CommandOrControl+Up',
        'CommandOrControl+Down',
        'CommandOrControl+Left',
        'CommandOrControl+Right',
        'CommandOrControl+Shift+Up',
        'CommandOrControl+Shift+Down',
    ]) {
        assert.match(source, new RegExp(`registerGlobalShortcut\\('${accelerator.replace(/[+\\]/g, '\\$&')}`));
    }
    assert.doesNotMatch(source, /CommandOrControl\+Shift\+M/);
    assert.match(source, /controller\.moveBy\(/);
    assert.match(source, /screen\.getDisplayMatching\(/);
    assert.match(source, /CAPSULE_SHAPE/);
    assert.match(source, /scrollExpandedWorkspace\('up'\)/);
    assert.match(source, /scrollExpandedWorkspace\('down'\)/);
    assert.match(source, /isVisible\(\)[\s\S]*getOverlaySnapshot\(\)\.target !== 'workspace'/);
    assert.match(source, /globalShortcut\.unregisterAll\(\)/);
});

test('main authorizes Windows system-audio loopback display capture', () => {
    const source = mainSource();

    assert.match(source, /desktopCapturer/);
    assert.match(source, /setDisplayMediaRequestHandler/);
    assert.match(source, /audio:\s*'loopback'/);
    assert.match(source, /types:\s*\['screen'\]/);
    assert.match(source, /thumbnailSize:\s*\{width:\s*0,\s*height:\s*0\}/);
    assert.match(source, /webContents\.fromFrame\(request\.frame\)/);
    assert.match(source, /isOverlayWebContents\(/);
    assert.match(source, /process\.platform\s*!==\s*'win32'/);
    assert.match(source, /function configureDisplayMediaCapture\(\): void/);
});

test('main broadcasts overlay-only and application-wide statuses to their intended windows', () => {
    const source = mainSource();

    assert.match(source, /function getLiveOverlayWindows\(\): BrowserWindow\[\]/);
    assert.match(source, /function getLiveApplicationWindows\(\): BrowserWindow\[\]/);
    for (const broadcaster of ['broadcastWindowState', 'broadcastOverlaySnapshot']) {
        const body = source.match(new RegExp(`function ${broadcaster}\\([^)]*\\): void \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
        assert.match(body, /getLiveOverlayWindows\(\)/, `${broadcaster} should fan out through getLiveOverlayWindows()`);
        assert.match(body, /\.webContents\.send\(/, `${broadcaster} should send to renderer webContents`);
    }
    for (const broadcaster of ['broadcastAsrModelStatus', 'broadcastPrivacyStatus', 'broadcastModelChanged']) {
        const body = source.match(new RegExp(`function ${broadcaster}\\([^)]*\\): void \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
        assert.match(body, /getLiveApplicationWindows\(\)/, `${broadcaster} should fan out through getLiveApplicationWindows()`);
        assert.match(body, /\.webContents\.send\(/, `${broadcaster} should send to renderer webContents`);
    }
    assert.match(source, /configureOverlayWindow\(browserWindow, manager\)/);
    assert.match(source, /manager\.registerWindow\(win\)/);
});

test('main keeps local ASR native work and PCM ports out of the renderer', () => {
    const source = mainSource();

    assert.match(source, /new MessageChannelMain\(\)/);
    assert.match(source, /IPC_CHANNELS\.asr\.start/);
    assert.match(source, /new AsrModelManager\(/);
    assert.match(source, /new LocalAsrEngine\(/);
    assert.match(source, /new AsrSessionCoordinator\(/);
    assert.match(source, /path\.join\(app\.getPath\('home'\), '\.cache', 'meeting-monster', 'models', 'asr'\)/);
    assert.doesNotMatch(source, /const userDataPath = app\.getPath\('userData'\)[\s\S]*new AsrModelManager/);
    assert.match(source, /await .*\.initialize\(\)[\s\S]*createMainWindow\(\)/);
    assert.doesNotMatch(source, /RemoteAsrClient|remote-asr-client|new globalThis\.WebSocket|\/ws\/asr|startRemote|loadConnection:\s*async/);
});

test('main registers fixed local ASR model IPC and MessagePort transport', () => {
    const source = mainSource();

    for (const channel of ['list', 'select', 'download', 'cancel', 'delete']) {
        assert.match(source, new RegExp(`IPC_CHANNELS\\.asrModels\\.${channel}`));
    }
    assert.match(source, /IPC_CHANNELS\.asr\.port/);
    assert.match(source, /new MessageChannelMain\(\)/);
    assert.match(source, /localAsrEngine!\.start/);
    assert.doesNotMatch(source, /\bnew WebSocket\b|new globalThis\.WebSocket|\/ws\/asr/);
});

test('main owns the native backend and disposes it with local ASR before quit', () => {
    const source = mainSource();

    assert.doesNotMatch(source, /RemoteApiClient|DEFAULT_BACKEND_URL|getRemoteApiClient/);
    assert.doesNotMatch(coordinatorSource(), /RemoteApiClient/);
    assert.match(source, /import \{BackendService\} from '\.\.\/backend\/backend-service'/);
    assert.match(source, /import \{[^}]*createBackendLifecycle[^}]*sanitizeBackendLifecycleError[^}]*\} from '\.\/backend-lifecycle'/s);
    assert.match(source, /modelConnectionStore = new ModelConnectionStore\([\s\S]*backendLifecycle = createBackendLifecycle\(new BackendService\(\{[\s\S]*connectionStore: modelConnectionStore[\s\S]*registerIpcHandlers\(\)/);
    assert.match(source, /IPC_CHANNELS\.models\.list/);
    assert.match(source, /IPC_CHANNELS\.chat\.send/);
    assert.match(source, /onOverlayWindowClosed\([\s\S]*disposeAsr\(\)/);
    assert.match(source, /app\.on\('before-quit', \(event\) => \{[\s\S]*event\?\.preventDefault\(\)[\s\S]*globalShortcut\.unregisterAll\(\)[\s\S]*disposeAsr\(\)[\s\S]*disposeForQuit\(\)[\s\S]*sanitizeBackendLifecycleError\(error\)[\s\S]*app\.quit\(\)/);
    assert.match(source, /app\.whenReady\(\)[\s\S]*\.catch\([\s\S]*disposeAsr\(\)/);
});

test('main verifies saved model vision before persisting and owns Assist screen capture', () => {
    const source = mainSource();
    const saveHandler = source.match(
        /ipcMain\.handle\(IPC_CHANNELS\.models\.save,[\s\S]*?\n    \}\);/,
    )?.[0] ?? '';
    const assistHandler = source.match(
        /ipcMain\.handle\(IPC_CHANNELS\.chat\.assist,[\s\S]*?\n    \}\);/,
    )?.[0] ?? '';

    assert.match(source, /import \{captureCurrentDisplay\} from '\.\/screen-capture'/);
    assert.match(
        source,
        /const ASSIST_SCREENSHOT_PROMPT = '请分析这张截图，并直接回答截图中显示的问题；如果有多个问题，请按顺序回答。';/,
    );
    assert.match(source, /function startChatRequest\([\s\S]*?image\?: ChatImageInput/);
    assert.match(source, /async function requireVerifiedSavedSelection/);
    assert.match(saveHandler, /getBackendService\(\)\.testModel\([\s\S]*?selection[\s\S]*?tested\.vision[\s\S]*?saveVerifiedConnection/);
    assert.doesNotMatch(saveHandler, /saveConnection\(/);
    assert.match(assistHandler, /isOverlayWebContents\(event\.sender\)/);
    assert.match(assistHandler, /reserveChatRequest\(id, event\.sender\)[\s\S]*?await requireVerifiedSavedSelection\(requestedSelection\)[\s\S]*?captureCurrentDisplay\(\{screen, desktopCapturer\}\)/);
    assert.match(assistHandler, /isCurrentChatRequest\(id, reserved\)[\s\S]*?return \{requestId: id\}/);
    assert.match(assistHandler, /captureCurrentDisplay[\s\S]*?isCurrentChatRequest\(id, reserved\)/);
    assert.match(assistHandler, /media_type: captured\.mediaType, data: captured\.data/);
    assert.match(assistHandler, /startChatRequest\([\s\S]*?content: ASSIST_SCREENSHOT_PROMPT[\s\S]*?image[\s\S]*?reserved/);
    assert.doesNotMatch(assistHandler, /content: unknown|requireText\(content/);
    assert.match(assistHandler, /return \{requestId: id\}/);
    assert.doesNotMatch(assistHandler, /return[^;]*(?:captured|image|data)/);
    assert.match(source, /throw new Error\('Model image capability is not verified'\)/);
    assert.match(source, /throw new Error\('Unable to capture the current screen'\)/);
});

test('main routes model list, test, and save through the native backend with sender-scoped progress', () => {
    const source = mainSource();
    const testHandler = source.match(
        /ipcMain\.handle\(IPC_CHANNELS\.models\.test,[\s\S]*?\n    \}\);/,
    )?.[0] ?? '';
    const saveHandler = source.match(
        /ipcMain\.handle\(IPC_CHANNELS\.models\.save,[\s\S]*?\n    \}\);/,
    )?.[0] ?? '';

    assert.match(ipcHandler(source, 'models.list'), /getBackendService\(\)\.listModelOptions\(\)/);
    assert.doesNotMatch(source, /runModelTestWithVisionRetries/);
    for (const handler of [testHandler, saveHandler]) {
        assert.match(handler, /isSettingsWebContents\(event\.sender\)/);
        assert.match(handler, /getBackendService\(\)\.testModel\(/);
        assert.match(handler, /event\.sender\.send\(IPC_CHANNELS\.models\.progress, progress\)/);
    }
    assert.doesNotMatch(testHandler, /broadcast|getLiveApplicationWindows/);
    assert.match(saveHandler, /broadcastModelChanged\(\)/);
    assert.match(
        saveHandler,
        /await getBackendService\(\)\.testModel\([\s\S]*?tested\.vision[\s\S]*?saveVerifiedConnection/,
    );
});

test('main protects deferred text and Assist handlers with reservation identity checks', () => {
    const source = mainSource();
    const sendHandler = source.match(
        /ipcMain\.handle\(IPC_CHANNELS\.chat\.send,[\s\S]*?\n    \}\);/,
    )?.[0] ?? '';
    const assistHandler = source.match(
        /ipcMain\.handle\(IPC_CHANNELS\.chat\.assist,[\s\S]*?\n    \}\);/,
    )?.[0] ?? '';

    assert.match(sendHandler, /const reserved = reserveChatRequest\(id, event\.sender\);[\s\S]*?await mergeSavedModelConnection[\s\S]*?isCurrentChatRequest\(id, reserved\)[\s\S]*?startChatRequest\([\s\S]*?reserved/);
    assert.match(assistHandler, /const reserved = reserveChatRequest\(id, event\.sender\);[\s\S]*?await requireVerifiedSavedSelection[\s\S]*?isCurrentChatRequest\(id, reserved\)[\s\S]*?await captureCurrentDisplay[\s\S]*?isCurrentChatRequest\(id, reserved\)/);
    assert.match(source, /function releaseChatRequest[\s\S]*?activeChatRequests\.get\(id\) === request/);
    assert.match(source, /function startChatRequest[\s\S]*?if \(args\.reserved && \(!isCurrentChatRequest\(args\.id, args\.reserved\)/);
    assert.match(source, /function startChatRequest[\s\S]*?args\.backend\.streamChat\([\s\S]*?active\.backendRequestId/);
    assert.match(source, /sendChatEvent\(args\.sender, \{requestId: args\.id, \.\.\.chatEvent\}\)/);
    assert.match(source, /ipcMain\.handle\(IPC_CHANNELS\.chat\.cancel,[\s\S]*?activeChatRequests\.get\(id\)[\s\S]*?activeRequest\.controller\.abort\(\)[\s\S]*?activeRequest\.backend\?\.cancel\(activeRequest\.backendRequestId\)/);
    assert.match(source, /catch \(error\) \{[\s\S]*?releaseChatRequest\(id, reserved\);[\s\S]*?throw error;/);
});

test('main owns the single-instance lifecycle and authorizes the quit IPC', () => {
    const source = mainSource();
    const secondInstanceHandler = source.match(/app\.on\('second-instance', \(\) => \{[\s\S]*?\n    \}\);/)?.[0] ?? '';
    const initialization = source.match(/void controller\.initialize\(\)\.then\(\(\) => \{[\s\S]*?\n    \}\)\.catch/)?.[0] ?? '';

    assert.match(source, /requestSingleInstanceLock\(\)/);
    assert.match(source, /if \(!hasSingleInstanceLock\) \{\s*app\.quit\(\);/);
    assert.match(secondInstanceHandler, /overlayController\?\.getWindow\(\)/);
    assert.match(secondInstanceHandler, /if \(overlay\.isMinimized\(\)\) overlay\.restore\(\);/);
    assert.match(secondInstanceHandler, /overlay\.show\(\);/);
    assert.match(secondInstanceHandler, /overlay\.focus\(\);/);
    assert.match(secondInstanceHandler, /secondInstancePending = true;/);
    assert.doesNotMatch(secondInstanceHandler, /createMainWindow\(\)/);
    assert.match(initialization, /if \(secondInstancePending\) \{/);
    assert.match(initialization, /secondInstancePending = false;/);
    assert.match(initialization, /overlay\.show\(\);/);
    assert.match(initialization, /overlay\.focus\(\);/);
    assert.match(source, /ipcMain\.handle\(IPC_CHANNELS\.window\.quit, \(event\) => \{[\s\S]*?isOverlayWebContents\(event\.sender\)[\s\S]*?setImmediate\(\(\) => app\.quit\(\)\)/);
});

test('main disables hardware acceleration before starting the transparent overlay', () => {
    const source = mainSource();

    assert.match(source, /typeof app\.disableHardwareAcceleration === 'function'\) app\.disableHardwareAcceleration\(\);/);
    assert.match(source, /app\.commandLine\?\.appendSwitch\) app\.commandLine\.appendSwitch\('in-process-gpu'\);/);
});
