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
    assert.match(panelApp, /className="panel-drag-handle"/);
    assert.match(panelApp, /className="panel-drag-hint"/);
    assert.match(panelApp, /visibleTarget === 'workspace' && <span className="panel-kicker">TRANSCRIPT<\/span>/);
    assert.match(panelApp, /visibleTarget === 'settings' && <span className="panel-title">连接与模型<\/span>/);
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
    assert.match(workspace, /MODEL_SETTINGS_CHANGED_EVENT/);
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

    assert.match(capsuleCss, /\.capsule-button\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*line-height:\s*1[^}]*white-space:\s*nowrap/s);
    assert.match(capsuleCss, /\.protection-button\s*\{[^}]*min-width:\s*5[234]px/s);
});

test('capsule expand button keeps its label and arrow in one button', () => {
    const capsuleApp = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'capsule', 'CapsuleApp.tsx'), 'utf8');
    const capsuleCss = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'capsule', 'capsule.css'), 'utf8');

    assert.match(
        capsuleApp,
        /<button[\s\S]*?aria-expanded=\{snapshot\.target === 'workspace'\}[\s\S]*?\{snapshot\.target === 'workspace' \? '收起' : '展开'\} <span aria-hidden="true">⌄<\/span>[\s\S]*?<\/button>/,
    );
    assert.match(capsuleCss, /\.capsule-button\s*>\s*span\s*\{[^}]*display:\s*inline-flex[^}]*flex:\s*0 0 auto[^}]*line-height:\s*1/s);
});
