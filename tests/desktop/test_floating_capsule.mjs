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
    assert.match(controller, /CAPSULE_BOUNDS = \{width: 248, height: 48\}/);
    assert.match(controller, /OVERLAY_BOUNDS = \{width: 648, height: 512\}/);
    assert.match(controller, /PANEL_OFFSET = \{x: -200, y: 62\}/);
    assert.doesNotMatch(controller, /toggle-settings|settings/);
});

test('capsule sends only the workspace overlay intent and keeps a drag-safe shell', () => {
    const source = read('desktop', 'ui', 'capsule', 'CapsuleApp.tsx');
    const styles = read('desktop', 'ui', 'capsule', 'capsule.css');
    assert.match(source, /overlay\.intent\(\{type: 'toggle-workspace'\}\)/);
    assert.match(source, /toggle-workspace/);
    assert.match(source, /className="capsule-chevron"/);
    assert.match(source, /viewBox="0 0 14 14"/);
    assert.match(source, /<svg\s+className="capsule-chevron"\s+viewBox="0 0 14 14"\s+aria-hidden="true">/);
    assert.match(source, /<path\s+d="M3\.5 5\.25 7 8\.75l3\.5-3\.5"\s*\/>/);
    assert.match(source, /<span className="capsule-chat-symbol" aria-hidden="true">ฅ<\/span>/);
    assert.doesNotMatch(source, /\u2304/);
    assert.doesNotMatch(source, /toggle-settings|settings/);
    assert.doesNotMatch(source, /privacy|PrivacyStatus|setCaptureProtection/);
    assert.doesNotMatch(source, /window\.setExpanded/);
    assert.match(styles, /-webkit-app-region:\s*drag/);
    assert.match(styles, /-webkit-app-region:\s*no-drag/);
    assert.match(styles, /background:\s*transparent/);
    assert.doesNotMatch(styles, /box-shadow/);
    const avatar = styles.match(/\.capsule-avatar\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const dot = styles.match(/\.capsule-dot\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    assert.match(avatar, /flex:\s*0\s+0\s+32px/);
    assert.match(avatar, /aspect-ratio:\s*1/);
    assert.match(avatar, /width:\s*32px/);
    assert.match(avatar, /height:\s*32px/);
    assert.match(dot, /flex:\s*0\s+0\s+7px/);
    assert.match(dot, /width:\s*7px/);
    assert.match(dot, /height:\s*7px/);
    const capsuleButton = styles.match(/\.capsule-button\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const capsuleStop = styles.match(/\.capsule-stop\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    assert.match(capsuleButton, /font-size:\s*11px/);
    assert.match(capsuleStop, /width:\s*30px/);
    assert.match(capsuleStop, /height:\s*30px/);
    const capsuleShell = styles.match(/\.capsule-shell\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const sharedControls = styles.match(/\.capsule-button,\s*\.capsule-stop\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const chevron = styles.match(/\.capsule-chevron\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const chatSymbol = styles.match(/\.capsule-chat-symbol\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const expandedButton = styles.match(/\.capsule-button:has\(\.capsule-chevron\)\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    assert.match(capsuleShell, /background:\s*rgba\(29,\s*36,\s*48,\s*0\.68\)/);
    assert.match(capsuleButton, /width:\s*70px/);
    assert.match(capsuleButton, /min-width:\s*70px/);
    assert.match(sharedControls, /height:\s*30px/);
    assert.match(chevron, /width:\s*14px/);
    assert.match(chevron, /height:\s*14px/);
    assert.match(chevron, /fill:\s*none/);
    assert.match(chevron, /stroke:\s*currentColor/);
    assert.match(chevron, /stroke-width:\s*1\.5/);
    assert.match(chevron, /stroke-linecap:\s*round/);
    assert.match(chevron, /stroke-linejoin:\s*round/);
    assert.match(expandedButton, /gap:\s*7px/);
    assert.match(chatSymbol, /width:\s*14px/);
    assert.match(chatSymbol, /height:\s*14px/);
    assert.match(chatSymbol, /flex:\s*0\s+0\s+14px/);
});

test('workspace menu owns privacy controls and warning state', () => {
    const source = read('desktop', 'ui', 'panel', 'WorkspaceMenu.tsx');
    const styles = read('desktop', 'ui', 'panel', 'panel.css');

    assert.match(source, /aria-label="更多"/);
    assert.match(source, /role="menu"/);
    assert.match(source, /role="menuitemcheckbox"/);
    assert.match(source, /aria-checked/);
    assert.match(source, /settings\.open\(\)/);
    assert.match(source, /privacy\.setCaptureProtection/);
    assert.match(source, /privacy-warning-dot/);
    assert.match(styles, /\.workspace-menu-popover\s*\{[^}]*width:\s*214px/s);
    assert.match(styles, /\.privacy-warning-dot\s*\{[^}]*#F3A35C/s);
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

test('panel keeps transparent shell, transform-only states, and worklet asset', () => {
    const styles = read('desktop', 'ui', 'panel', 'panel.css');
    const panel = read('desktop', 'ui', 'panel', 'PanelApp.tsx');
    const worklet = read('desktop', 'ui', 'public', 'recorder_worklet.js');
    assert.match(styles, /background:\s*transparent/);
    assert.match(styles, /panel-enter/);
    assert.match(styles, /panel-visible/);
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

test('settings keeps its independent main content scrollable', () => {
    const styles = read('desktop', 'ui', 'settings', 'settings.css');
    assert.match(styles, /\.settings-main\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
    assert.match(styles, /\.settings-status,[\s\S]*\.settings-error,[\s\S]*\.asr-status\s*\{[^}]*overflow-wrap:\s*anywhere/s);
});

test('settings uses light chrome tokens, a titlebar drag region, and semantic status colors', () => {
    const styles = read('desktop', 'ui', 'settings', 'settings.css');
    const approved = new Set([
        '#f4f5f7', '#ffffff', '#f8fafc', '#ffffff', '#161b22', '#697386',
        '#4b8ef7', '#286fe0', '#178a4c', '#c15e1f',
    ]);
    const used = new Set((styles.match(/#[0-9a-f]{6}/gi) ?? []).map((color) => color.toLowerCase()));
    assert.deepEqual([...used].filter((color) => !approved.has(color)), []);
    assert.match(styles, /color-scheme:\s*light/);
    assert.match(styles, /--sidebar:\s*#F4F5F7/);
    assert.match(styles, /--canvas:\s*#FFFFFF/);
    assert.match(styles, /grid-template-rows:\s*42px/);
    assert.match(styles, /grid-template-columns:\s*var\(--sidebar-width\)/);
    assert.match(styles, /--sidebar-width:\s*210px/);
    assert.match(styles, /grid-template-columns:\s*var\(--sidebar-width\)\s+minmax\(0,\s*1fr\)/);
    assert.match(styles, /\.settings-titlebar::before\s*\{[^}]*width:\s*var\(--sidebar-width\)/s);
    assert.match(styles, /@media \(max-width:\s*820px\)\s*\{[\s\S]*?--sidebar-width:\s*170px/s);
    assert.match(styles, /@media \(max-width:\s*600px\)\s*\{[\s\S]*?--sidebar-width:\s*148px/s);
    assert.match(styles, /\.settings-titlebar\s*\{[^}]*-webkit-app-region:\s*drag/s);
    assert.match(styles, /\.settings-close\s*,[\s\S]*-webkit-app-region:\s*no-drag/s);
    assert.match(styles, /\.settings-actions button\.primary\s*\{[^}]*color:\s*#FFFFFF/s);
    assert.match(styles, /\.settings-actions button\.primary \.model-action-spinner\s*\{[^}]*border-top-color:\s*#FFFFFF/s);
    assert.match(styles, /\.settings-nav\.is-active\s*\{[^}]*background:\s*var\(--field\)[^}]*border-color:\s*rgba\(75,\s*142,\s*247,\s*0\.3\)/s);
    assert.doesNotMatch(styles, /gradient/i);
    assert.match(styles, /\.settings-status\.is-error,[\s\S]*\.asr-status\.is-error\s*\{[^}]*color:\s*var\(--warning\)/s);
    assert.match(styles, /\.settings-status\.is-success,[\s\S]*\.asr-status\.is-success\s*\{[^}]*color:\s*var\(--success\)/s);
});

test('rounded panel shell does not paint a clipped shadow behind its lower corners', () => {
    const styles = read('desktop', 'ui', 'panel', 'panel.css');
    const panelShell = styles.match(/\.panel-shell\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    assert.match(panelShell, /border-radius:\s*28px/);
    assert.doesNotMatch(panelShell, /box-shadow/);
});

test('single overlay keeps the capsule visually detached above the panel', () => {
    const styles = read('desktop', 'ui', 'overlay', 'overlay.css');
    const panelLayer = styles.match(/\.panel-layer\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    assert.match(panelLayer, /top:\s*62px/);
    assert.match(panelLayer, /height:\s*450px/);
    assert.match(panelLayer, /pointer-events:\s*none/);
});

test('privacy policy retains protected overlay defaults and no renderer redaction shield', () => {
    const main = read('desktop', 'src', 'main', 'main.ts');
    assert.match(main, /taskbarHidden: true/);
    assert.match(main, /CommandOrControl\+Shift\+P/);
    assert.match(main, /setCaptureProtection/);
    assert.doesNotMatch(main, /privacyRedactionShield|toggleRedacted/);
});
