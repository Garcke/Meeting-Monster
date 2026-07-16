import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlayHtmlPath = path.join(projectRoot, 'static', 'overlay.html');
const overlayCssPath = path.join(projectRoot, 'static', 'overlay.css');
const overlayJsPath = path.join(projectRoot, 'static', 'overlay.js');

test('Electron overlay page is a dedicated compact renderer', () => {
    const html = fs.readFileSync(overlayHtmlPath, 'utf8');
    const css = fs.readFileSync(overlayCssPath, 'utf8');
    const js = fs.readFileSync(overlayJsPath, 'utf8');

    assert.match(html, /id="overlayRoot"/);
    assert.match(html, /id="capsuleProtectionToggle"/);
    assert.match(html, /id="overlayStartButton"/);
    assert.match(html, /id="overlayAnswerButton"/);
    assert.match(html, /id="overlayComposer"/);
    assert.doesNotMatch(html, /workspace-grid|privacyRedactionShield|privacyToggleButton/);
    assert.match(css, /\.overlay-root/);
    assert.match(css, /\.overlay-root\.is-expanded/);
    assert.match(css, /\.overlay-header\s*\{[\s\S]*border-bottom/);
    assert.doesNotMatch(css, /margin:\s*\d+px;\s*\/\* outer gap \*\//);
    assert.match(js, /\/ws\/asr/);
    assert.match(js, /API_BASE_URL.*\/chat\//);
    assert.match(js, /PCMAudioRecorder/);
    assert.match(js, /ReadableStream|reader\.read/);
});

test('Electron main process loads the dedicated overlay page', () => {
    const main = fs.readFileSync(path.join(projectRoot, 'desktop', 'main.js'), 'utf8');
    assert.match(main, /SERVER_URL\}\/overlay\.html/);
    assert.doesNotMatch(main, /loadURL\(SERVER_URL\)/);
});
