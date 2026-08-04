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

function countMatches(source, pattern) {
    return [...source.matchAll(pattern)].length;
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
    assert.match(controller, /width: 360, height: 56/);
    assert.match(controller, /width: 648, height: 520/);
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
        /CommandOrControl\+Shift\+M/,
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

    assert.match(source, /function isAuthorizedSender/);
    assert.match(source, /if \(!isAuthorizedSender\(event\)\) throw new Error\('Unauthorized/);
    assert.match(source, /ipcMain\.removeHandler\(/);
    assert.match(source, /if \(ipcHandlersRegistered\) return/);

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

test('main authorizes only the single controller webContents', () => {
    const source = mainSource();

    const authorization = source.match(/function isAuthorizedWebContents\(sender: WebContents\): boolean \{[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(authorization, /overlayController\?\.getWindow\(\)/);
    assert.match(authorization, /senderWindow === overlayWindow/);
    assert.doesNotMatch(authorization, /BrowserWindow\.getAllWindows\(\)|senderWindow === mainWindow/);
    assert.doesNotMatch(source, /function isPanelWebContents\(sender: WebContents\)/);
    assert.doesNotMatch(source, /isPanelWebContents\(event\.sender\)/);
});

test('main authorizes Windows system-audio loopback display capture', () => {
    const source = mainSource();

    assert.match(source, /desktopCapturer/);
    assert.match(source, /setDisplayMediaRequestHandler/);
    assert.match(source, /audio:\s*'loopback'/);
    assert.match(source, /types:\s*\['screen'\]/);
    assert.match(source, /thumbnailSize:\s*\{width:\s*0,\s*height:\s*0\}/);
    assert.match(source, /webContents\.fromFrame\(request\.frame\)/);
    assert.match(source, /isAuthorizedWebContents\(/);
    assert.match(source, /process\.platform\s*!==\s*'win32'/);
    assert.match(source, /function configureDisplayMediaCapture\(\): void/);
});

test('main broadcasts window, privacy, overlay, and ASR model statuses to all live overlay windows', () => {
    const source = mainSource();

    assert.match(source, /function getLiveOverlayWindows\(\): BrowserWindow\[\]/);
    for (const broadcaster of ['broadcastAsrModelStatus', 'broadcastWindowState', 'broadcastPrivacyStatus', 'broadcastOverlaySnapshot']) {
        const body = source.match(new RegExp(`function ${broadcaster}\\([^)]*\\): void \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
        assert.match(body, /getLiveOverlayWindows\(\)/, `${broadcaster} should fan out through getLiveOverlayWindows()`);
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

test('main preserves remote AI chat and disposes local ASR on every app lifecycle exit', () => {
    const source = mainSource();

    assert.match(source, /RemoteApiClient/);
    assert.match(source, /DEFAULT_BACKEND_URL = 'http:\/\/127\.0\.0\.1:9000\/'/);
    assert.match(source, /IPC_CHANNELS\.models\.list/);
    assert.match(source, /IPC_CHANNELS\.chat\.send/);
    assert.match(source, /onOverlayWindowClosed\([\s\S]*disposeAsr\(\)/);
    assert.match(source, /app\.on\('before-quit', \(\) => \{[\s\S]*disposeAsr\(\)/);
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
    assert.match(source, /function startChatRequest\([\s\S]*?image\?: ChatImageInput/);
    assert.match(source, /async function requireVerifiedSavedSelection/);
    assert.match(saveHandler, /testSelectedModel\(selection\)[\s\S]*?tested\.vision[\s\S]*?saveVerifiedConnection/);
    assert.doesNotMatch(saveHandler, /saveConnection\(/);
    assert.match(assistHandler, /isAuthorizedSender\(event\)/);
    assert.match(assistHandler, /reserveChatRequest\(id, event\.sender\)[\s\S]*?await requireVerifiedSavedSelection\(requestedSelection\)[\s\S]*?captureCurrentDisplay\(\{screen, desktopCapturer\}\)/);
    assert.match(assistHandler, /isCurrentChatRequest\(id, reserved\)[\s\S]*?return \{requestId: id\}/);
    assert.match(assistHandler, /captureCurrentDisplay[\s\S]*?isCurrentChatRequest\(id, reserved\)/);
    assert.match(assistHandler, /media_type: captured\.mediaType, data: captured\.data/);
    assert.match(assistHandler, /startChatRequest\([\s\S]*?image[\s\S]*?reserved/);
    assert.match(assistHandler, /return \{requestId: id\}/);
    assert.doesNotMatch(assistHandler, /return[^;]*(?:captured|image|data)/);
    assert.match(source, /throw new Error\('Model image capability is not verified'\)/);
    assert.match(source, /throw new Error\('Unable to capture the current screen'\)/);
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
    assert.match(source, /ipcMain\.handle\(IPC_CHANNELS\.window\.quit, \(event\) => \{[\s\S]*?isAuthorizedSender\(event\)[\s\S]*?setImmediate\(\(\) => app\.quit\(\)\)/);
});

test('main disables hardware acceleration before starting the transparent overlay', () => {
    const source = mainSource();

    assert.match(source, /typeof app\.disableHardwareAcceleration === 'function'\) app\.disableHardwareAcceleration\(\);/);
    assert.match(source, /app\.commandLine\?\.appendSwitch\) app\.commandLine\.appendSwitch\('in-process-gpu'\);/);
});
