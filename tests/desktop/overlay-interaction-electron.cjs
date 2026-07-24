const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const panelPath = path.join(projectRoot, 'desktop', 'dist', 'renderer', 'overlay.html');
const preloadPath = path.join(__dirname, 'overlay-interaction-preload.cjs');
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-overlay-'));

app.setPath('userData', userDataPath);
app.setPath('sessionData', userDataPath);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-gl', 'swiftshader');

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function clickElement(window, selector) {
    const rect = await window.webContents.executeJavaScript(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing element: ' + ${JSON.stringify(selector)});
        const rect = element.getBoundingClientRect();
        return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
    })()`);
    window.webContents.sendInputEvent({type: 'mouseMove', x: rect.x, y: rect.y});
    window.webContents.sendInputEvent({type: 'mouseDown', button: 'left', clickCount: 1});
    window.webContents.sendInputEvent({type: 'mouseUp', button: 'left', clickCount: 1});
    await delay(40);
}

async function run() {
    if (!fs.existsSync(panelPath)) throw new Error(`Built panel entry is missing: ${panelPath}`);
    const window = new BrowserWindow({
        width: 648,
        height: 520,
        show: true,
        webPreferences: {contextIsolation: true, nodeIntegration: false, preload: preloadPath},
    });
    await window.loadFile(panelPath);
    await delay(120);

    const opened = await window.webContents.executeJavaScript(`(() => {
        const scroll = document.querySelector('.settings-scroll');
        scroll.style.height = '120px';
        scroll.style.flex = '0 0 120px';
        scroll.scrollTop = 0;
        return {
            settingsVisible: document.querySelector('[data-target="settings"]') !== null,
            workspaceHidden: document.querySelector('.workspace-content')?.classList.contains('is-inactive') ?? true,
            scrollHeight: scroll.scrollHeight,
            clientHeight: scroll.clientHeight,
            modelOptions: document.querySelectorAll('#modelProfileSelect option').length,
            asrOptions: document.querySelectorAll('#asrModelSelect option').length,
        };
    })()`);

    const scrollRect = await window.webContents.executeJavaScript(`(() => {
        const rect = document.querySelector('.settings-scroll').getBoundingClientRect();
        return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 50)};
    })()`);
    window.webContents.sendInputEvent({type: 'mouseMove', x: scrollRect.x, y: scrollRect.y});
    window.webContents.sendInputEvent({type: 'mouseWheel', x: scrollRect.x, y: scrollRect.y, deltaX: 0, deltaY: 600});
    await delay(80);
    const scrolled = await window.webContents.executeJavaScript("document.querySelector('.settings-scroll').scrollTop");
    await clickElement(window, '#modelApiKey');
    const focusedId = await window.webContents.executeJavaScript('document.activeElement?.id || ""');

    const result = {...opened, scrolled, focusedId};
    window.destroy();
    await app.quit();
    process.stdout.write(`OVERLAY_INTERACTION_RESULT ${JSON.stringify(result)}\n`);
}

app.whenReady().then(() => run().catch((error) => {
    process.stderr.write(`OVERLAY_INTERACTION_ENV_UNAVAILABLE ${String(error.stack || error)}\n`);
    app.exit(2);
}));
