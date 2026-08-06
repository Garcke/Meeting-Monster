const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const settingsPath = path.join(projectRoot, 'desktop', 'dist', 'renderer', 'settings.html');
const preloadPath = path.join(__dirname, 'settings-interaction-preload.cjs');
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-settings-'));

app.setPath('userData', userDataPath);
app.setPath('sessionData', userDataPath);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-gl', 'swiftshader');

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function clickElement(window, selector) {
    const point = await window.webContents.executeJavaScript(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing element: ' + ${JSON.stringify(selector)});
        const rect = element.getBoundingClientRect();
        return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
    })()`);
    window.webContents.sendInputEvent({type: 'mouseMove', x: point.x, y: point.y});
    window.webContents.sendInputEvent({type: 'mouseDown', button: 'left', clickCount: 1, x: point.x, y: point.y});
    window.webContents.sendInputEvent({type: 'mouseUp', button: 'left', clickCount: 1, x: point.x, y: point.y});
    await delay(50);
}

async function waitForSettings(window) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const ready = await window.webContents.executeJavaScript(`(() => (
            document.querySelectorAll('.settings-nav').length === 2
            && document.querySelectorAll('#modelProtocol option').length === 2
            && document.querySelectorAll('#asrModelSelect option').length === 2
        ))()`);
        if (ready) return;
        await delay(50);
    }
    throw new Error('Settings renderer did not hydrate both model selectors');
}

async function run() {
    if (!fs.existsSync(settingsPath)) throw new Error(`Built settings entry is missing: ${settingsPath}`);
    const window = new BrowserWindow({
        width: 940,
        height: 640,
        show: true,
        transparent: false,
        webPreferences: {contextIsolation: true, nodeIntegration: false, preload: preloadPath},
    });
    await window.loadFile(settingsPath);
    await waitForSettings(window);

    await clickElement(window, '.settings-nav:nth-of-type(1)');
    const modelsVisible = await window.webContents.executeJavaScript("!document.querySelectorAll('.settings-page')[0].hidden");
    await clickElement(window, '.settings-nav:nth-of-type(2)');
    const speechVisible = await window.webContents.executeJavaScript("!document.querySelectorAll('.settings-page')[1].hidden");
    await clickElement(window, '.settings-nav:nth-of-type(1)');

    const dimensions = await window.webContents.executeJavaScript(`(() => {
        const main = document.querySelector('.settings-main');
        main.style.height = '180px';
        main.style.alignSelf = 'start';
        main.scrollTop = 0;
        const rect = main.getBoundingClientRect();
        return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + Math.min(80, rect.height / 2)),
            scrollHeight: main.scrollHeight,
            clientHeight: main.clientHeight,
            modelOptions: document.querySelectorAll('#modelProtocol option').length,
            asrOptions: document.querySelectorAll('#asrModelSelect option').length,
        };
    })()`);
    window.webContents.sendInputEvent({type: 'mouseMove', x: dimensions.x, y: dimensions.y});
    window.webContents.sendInputEvent({type: 'mouseDown', button: 'left', clickCount: 1, x: dimensions.x, y: dimensions.y});
    window.webContents.sendInputEvent({type: 'mouseUp', button: 'left', clickCount: 1, x: dimensions.x, y: dimensions.y});
    window.webContents.sendInputEvent({type: 'mouseWheel', x: dimensions.x, y: dimensions.y, deltaX: 0, deltaY: -600, canScroll: true});
    await delay(80);
    const scrolled = await window.webContents.executeJavaScript("document.querySelector('.settings-main').scrollTop");
    if (!(scrolled > 0)) throw new Error('Native wheel input did not reach the settings renderer');
    await window.webContents.executeJavaScript("document.querySelector('#modelApiKey').scrollIntoView({block: 'center'})");
    await clickElement(window, '#modelApiKey');
    const focusedId = await window.webContents.executeJavaScript("document.activeElement?.id || ''");

    const result = {
        modelsVisible,
        speechVisible,
        scrollHeight: dimensions.scrollHeight,
        clientHeight: dimensions.clientHeight,
        scrolled,
        focusedId,
        modelOptions: dimensions.modelOptions,
        asrOptions: dimensions.asrOptions,
    };
    window.destroy();
    process.stdout.write(`SETTINGS_INTERACTION_RESULT ${JSON.stringify(result)}\n`, () => app.exit(0));
}

app.whenReady().then(() => run().catch((error) => {
    process.stderr.write(`SETTINGS_INTERACTION_ENV_UNAVAILABLE ${String(error.stack || error)}\n`);
    app.exit(2);
}));
