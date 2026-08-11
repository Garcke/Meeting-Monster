import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('web client is removed while Electron entrypoints remain', () => {
    const projectEntries = fs.readdirSync(projectRoot, {withFileTypes: true});
    assert.equal(
        projectEntries.some((entry) => entry.isDirectory() && entry.name === 'web'),
        false,
    );
    assert.equal(fs.existsSync(path.join(projectRoot, 'desktop', 'ui', 'overlay.html')), true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'desktop', 'ui', 'settings.html')), true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'desktop', 'ui', 'capsule.html')), false);
    assert.equal(fs.existsSync(path.join(projectRoot, 'desktop', 'ui', 'panel.html')), false);
    assert.equal(fs.existsSync(path.join(projectRoot, 'desktop', 'ui', 'overlay', 'main.tsx')), true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'desktop', 'src', 'main', 'main.ts')), true);
});

test('workspace header omits the What should I say prompt pill', () => {
    const panelApp = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'PanelApp.tsx'), 'utf8');
    const workspace = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'WorkspaceView.tsx'), 'utf8');
    const panelCss = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'panel.css'), 'utf8');

    assert.doesNotMatch(panelApp, /panel-prompt|What should I say\?/);
    assert.doesNotMatch(panelCss, /\.panel-prompt\s*\{/);
    assert.match(panelApp, /className="panel-drag-handle" data-drag-handle/);
    assert.doesNotMatch(panelApp, /panel-drag-hint|\u62d6\u52a8\u9762\u677f/);
    assert.doesNotMatch(panelCss, /\.panel-drag-hint\s*\{/);
    assert.match(panelCss, /\.workspace-menu\s*\{[^}]*margin-left:\s*auto/s);
    assert.match(panelApp, /<span className="panel-kicker">TRANSCRIPT<\/span>/);
    assert.match(panelApp, /<WorkspaceMenu\s*\/>/);
    assert.doesNotMatch(panelApp, /SettingsView|settings/);
    assert.equal(fs.existsSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'SettingsView.tsx')), false);
    assert.doesNotMatch(workspace, /\u5f00\u59cb\u8f6c\u5199\u540e\uff0c\u5f53\u524d\u95ee\u9898\u4f1a\u663e\u793a\u5728\u8fd9\u91cc/);
    assert.match(workspace, /className="answer-scroll no-drag"/);
    assert.match(panelCss, /\.workspace-content\s*\{[^}]*display:\s*grid/s);
    assert.doesNotMatch(workspace, /className="workspace-toolbar no-drag"/);
    assert.match(workspace, /className="composer-actions"[\s\S]*Assist[\s\S]*\u8ffd\u95ee[\s\S]*\u91cd\u8ff0/);
    assert.match(workspace, /async function assistWithScreenshot\(\)[\s\S]*api\.chat\.assist/);
    assert.match(workspace, /api\.chat\.assist\(requestId\)/);
    assert.doesNotMatch(workspace, /api\.chat\.assist\(requestId,\s*selectedText/);
    assert.match(workspace, /async function sendText\(requestedAction:[\s\S]*api\.chat\.send/);
    assert.match(workspace, /onClick=\{\(\) => \{ setAction\('assist'\); void assistWithScreenshot\(\); \}\}/);
    assert.match(workspace, /onClick=\{\(\) => \{ setAction\('followup'\); void sendText\('followup'\); \}\}/);
    assert.match(workspace, /onClick=\{\(\) => \{ setAction\('recap'\); void sendText\('recap'\); \}\}/);
    assert.match(workspace, /function submit[\s\S]*sendText\('direct'\)/);
    assert.match(workspace, /api\.models\.onChanged\(refreshModelSettings\)/);
    assert.match(workspace, /api\.models\.getSaved\(\)/);
    assert.doesNotMatch(workspace, /MODEL_SETTINGS_CHANGED_EVENT|loadModelSettings/);
    assert.match(workspace, /vision_verified === true/);
    assert.doesNotMatch(workspace, /image\/png|base64/i);
    assert.match(panelCss, /\.assist-hint\s*\{/);
    assert.match(panelCss, /grid-template-rows:\s*minmax\(96px,\s*35fr\)\s+minmax\(160px,\s*65fr\)\s+auto/);
    assert.match(panelCss, /\.workspace-transcript\s*\{[^}]*overflow-y:\s*auto/s);
    assert.match(panelCss, /\.answer-scroll\s*\{[^}]*overflow-y:\s*auto/s);
    assert.match(panelCss, /\.composer-actions\s*\{[^}]*white-space:\s*nowrap/s);
});

test('capsule action buttons keep their labels on one centered line', () => {
    const capsuleCss = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'capsule', 'capsule.css'), 'utf8');

    assert.match(capsuleCss, /\.capsule-button\.ant-btn\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*line-height:\s*1[^}]*white-space:\s*nowrap/s);
    assert.doesNotMatch(capsuleCss, /\.protection-button\s*\{/);
});

test('capsule expand button uses Chat when closed and chevron Hide when expanded', () => {
    const capsuleApp = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'capsule', 'CapsuleApp.tsx'), 'utf8');
    const capsuleCss = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'capsule', 'capsule.css'), 'utf8');

    assert.match(capsuleApp, /<Button className="capsule-button"[\s\S]*?aria-expanded=\{snapshot\.target === 'workspace'\}/);
    assert.match(capsuleApp, /\{snapshot\.target === 'workspace' \? \(/);
    assert.match(capsuleApp, /<span>Hide<\/span>/);
    assert.match(capsuleApp, /<svg className="capsule-chat-symbol" viewBox="0 0 1259 1024" aria-hidden="true">/);
    assert.match(capsuleApp, /<path d="M635\.211887 354\.085959c-236\.873121 0-430\.651342[\s\S]*?75\.34166z" \/>/);
    assert.match(capsuleApp, /<span>Chat<\/span>/);
    assert.match(capsuleApp, /<svg className="capsule-chevron" viewBox="0 0 14 14" aria-hidden="true">/);
    assert.match(capsuleApp, /<path d="M3\.5 5\.25 7 8\.75l3\.5-3\.5" \/>/);
    assert.equal((capsuleApp.match(/className="capsule-button-content"/g) ?? []).length, 2);
    assert.doesNotMatch(capsuleApp, /\u2304/);
    assert.match(capsuleCss, /\.capsule-button\s*>\s*span\s*\{[^}]*display:\s*inline-flex[^}]*flex:\s*0 0 auto[^}]*line-height:\s*1/s);
    assert.match(capsuleCss, /\.capsule-button\.ant-btn\s*\{[^}]*width:\s*76px[^}]*min-width:\s*76px[^}]*gap:\s*0/s);
    assert.doesNotMatch(capsuleCss, /\.capsule-button\.ant-btn\s*\{[^}]*gap:\s*14px/s);
    assert.match(capsuleCss, /\.capsule-button-content\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*gap:\s*12px/s);
    assert.doesNotMatch(capsuleCss, /\.capsule-button\.ant-btn\s*\{[^}]*width:\s*70px/s);
    assert.doesNotMatch(capsuleCss, /\.capsule-button\.ant-btn\s*\{[^}]*min-width:\s*70px/s);
    assert.doesNotMatch(capsuleCss, /\.capsule-button\.ant-btn\s*\{[^}]*gap:\s*10px/s);
    assert.match(capsuleCss, /\.capsule-chat-symbol\s*\{[^}]*width:\s*14px[^}]*height:\s*14px[^}]*flex:\s*0 0 14px/s);
});

test('expanded panel shares the capsule translucent surface', () => {
    const panelCss = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'panel.css'), 'utf8');

    assert.match(panelCss, /\.panel-shell\s*\{[^}]*background:\s*rgba\(29,\s*36,\s*48,\s*0\.68\)[^}]*border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.17\)/s);
});

test('workspace dropdown keeps a dark surface and readable menu text', () => {
    const panelCss = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'panel.css'), 'utf8');
    const theme = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'shared', 'antd-theme.tsx'), 'utf8');
    const dropdownMenu = panelCss.match(/\.workspace-menu-popover \.ant-dropdown-menu\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const dropdownItem = panelCss.match(/\.workspace-menu-popover \.ant-dropdown-menu-item\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const dropdownTitle = panelCss.match(/\.workspace-menu-popover \.ant-dropdown-menu-item-group-title\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const overlayToken = theme.match(/const overlayTheme: ThemeConfig = \{\s*token:\s*\{([\s\S]*?)\n\s*\},\n\};/)?.[1] ?? '';

    assert.match(dropdownMenu, /background:\s*#151B25/);
    assert.match(dropdownMenu, /color:\s*#eef2f8/);
    assert.match(dropdownItem, /color:\s*#eef2f8/);
    assert.match(dropdownTitle, /color:\s*rgba\(230,\s*237,\s*248,\s*0\.5\)/);
    assert.doesNotMatch(panelCss, /\.workspace-menu-popover \.ant-menu-item(?:\s|\{|:|,)/);

    assert.match(overlayToken, /\.\.\.commonToken,/);
    assert.match(overlayToken, /colorText:\s*'#EEF2F8'/);
    assert.match(overlayToken, /colorTextDescription:\s*'rgba\(230, 237, 248, 0\.62\)'/);
    assert.match(overlayToken, /colorTextDisabled:\s*'rgba\(230, 237, 248, 0\.48\)'/);
    assert.match(overlayToken, /colorBgElevated:\s*'#151B25'/);
    assert.match(overlayToken, /controlItemBgHover:\s*'rgba\(121, 185, 255, 0\.17\)'/);
    assert.match(overlayToken, /controlItemBgActive:\s*'rgba\(121, 185, 255, 0\.22\)'/);
});

test('settings chrome keeps the close control inside the dedicated titlebar', () => {
    const settingsApp = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'settings', 'SettingsApp.tsx'), 'utf8');

    assert.match(settingsApp, /<header className="settings-titlebar">[\s\S]*?<Button className="settings-close"[\s\S]*?<\/header>/);
    assert.match(settingsApp, /<aside className="settings-sidebar">/);
    assert.match(settingsApp, /<section className="settings-main">/);
});
