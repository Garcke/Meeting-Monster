import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => fs.readFileSync(path.join(projectRoot, ...parts), 'utf8');

test('main uses a fixed single-window overlay without legacy resizing', () => {
    const source = read('desktop', 'src', 'main', 'main.ts');
    const controller = read('desktop', 'src', 'main', 'overlay-window-controller.ts');
    assert.match(source, /createOverlayWindowController\(/);
    assert.match(source, /rendererRoot:\s*path\.join\(__dirname, '\.\.', 'renderer'\)/);
    assert.doesNotMatch(source, /width:\s*720,\s*height:\s*520|setWindowMode\(|EXPANDED_BOUNDS/);
    assert.match(controller, /CAPSULE_BOUNDS = \{width: 360, height: 56\}/);
    assert.match(controller, /OVERLAY_BOUNDS = \{width: 648, height: 520\}/);
    assert.match(controller, /PANEL_OFFSET = \{x: -144, y: 70\}/);
});

test('capsule buttons use independent overlay intents and a drag-safe shell', () => {
    const source = read('desktop', 'ui', 'capsule', 'CapsuleApp.tsx');
    const styles = read('desktop', 'ui', 'capsule', 'capsule.css');
    assert.match(source, /overlay\.intent\(\{type\}\)/);
    assert.match(source, /toggle-settings/);
    assert.match(source, /toggle-workspace/);
    assert.doesNotMatch(source, /window\.setExpanded/);
    assert.match(styles, /-webkit-app-region:\s*drag/);
    assert.match(styles, /-webkit-app-region:\s*no-drag/);
    assert.match(styles, /background:\s*transparent/);
    assert.doesNotMatch(styles, /box-shadow/);
    const avatar = styles.match(/\.capsule-avatar\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const dot = styles.match(/\.capsule-dot\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    assert.match(avatar, /flex:\s*0\s+0\s+34px/);
    assert.match(avatar, /aspect-ratio:\s*1/);
    assert.match(avatar, /width:\s*34px/);
    assert.match(avatar, /height:\s*34px/);
    assert.match(dot, /flex:\s*0\s+0\s+7px/);
    assert.match(dot, /width:\s*7px/);
    assert.match(dot, /height:\s*7px/);
    const capsuleButton = styles.match(/\.capsule-button\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const capsuleStop = styles.match(/\.capsule-stop\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    assert.match(capsuleButton, /height:\s*32px/);
    assert.match(capsuleButton, /font-size:\s*11px/);
    assert.match(capsuleStop, /width:\s*32px/);
    assert.match(capsuleStop, /height:\s*32px/);
});

test('capsule width budget keeps the status grip shrinkable before controls', () => {
    const styles = read('desktop', 'ui', 'capsule', 'capsule.css');
    const grip = styles.match(/\.capsule-grip\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const status = styles.match(/\.capsule-status\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const controls = styles.match(/\.capsule-button,\s*\.capsule-stop\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    assert.match(grip, /flex:\s*1\s+1\s+auto/);
    assert.match(grip, /min-width:\s*0/);
    assert.match(status, /overflow:\s*hidden/);
    assert.match(status, /min-width:\s*0/);
    assert.match(status, /text-overflow:\s*ellipsis/);
    assert.match(controls, /-webkit-app-region:\s*no-drag/);
    assert.match(controls, /flex:\s*0\s+0\s+auto/);
    assert.match(styles, /\.capsule-shell\s*\{[\s\S]*?border-radius:\s*999px[\s\S]*?overflow:\s*hidden/);
});

test('panel keeps transparent shell, transform-only states, scroll pointer safety, and worklet asset', () => {
    const styles = read('desktop', 'ui', 'panel', 'panel.css');
    const panel = read('desktop', 'ui', 'panel', 'PanelApp.tsx');
    const worklet = read('desktop', 'ui', 'public', 'recorder_worklet.js');
    assert.match(styles, /background:\s*transparent/);
    assert.match(styles, /panel-enter/);
    assert.match(styles, /panel-visible/);
    assert.match(styles, /settings-scroll/);
    assert.match(styles, /-webkit-app-region:\s*no-drag/);
    assert.match(styles, /transition:\s*transform\s+140ms\s+ease/);
    const enter = styles.match(/\.panel-shell\.panel-enter\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const exit = styles.match(/\.panel-shell\.panel-exit\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    assert.match(enter, /opacity:\s*1/);
    assert.match(exit, /opacity:\s*1/);
    assert.doesNotMatch(enter, /opacity:\s*0\.15/);
    assert.doesNotMatch(exit, /opacity:\s*0\.15/);
    assert.match(styles, /\.composer-ai-action\s*\{[^}]*font-size:\s*12px/s);
    assert.match(styles, /\.record-action\s*\{[^}]*font-size:\s*11\.5px/s);
    assert.match(styles, /\.send-button\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/s);
    assert.match(panel, /snapshot\.phase\s*!==\s*'opening'/);
    assert.match(panel, /rendererReady\(snapshot\.revision\)/);
    assert.match(panel, /animationFinished\(snapshot\.revision\)/);
    assert.match(worklet, /registerProcessor\('pcm-processor'/);
});

test('single overlay keeps the capsule visually detached above the panel', () => {
    const styles = read('desktop', 'ui', 'overlay', 'overlay.css');
    const panelLayer = styles.match(/\.panel-layer\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    assert.match(panelLayer, /top:\s*70px/);
    assert.match(panelLayer, /height:\s*450px/);
    assert.match(panelLayer, /pointer-events:\s*none/);
});

test('privacy policy retains protected overlay defaults and no renderer redaction shield', () => {
    const main = read('desktop', 'src', 'main', 'main.ts');
    assert.match(main, /taskbarHidden: false/);
    assert.match(main, /CommandOrControl\+Shift\+P/);
    assert.match(main, /setCaptureProtection/);
    assert.doesNotMatch(main, /privacyRedactionShield|toggleRedacted/);
});
