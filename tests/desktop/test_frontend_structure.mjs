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

test('workspace keeps the compact starred prompt pill in the fixed panel header', () => {
    const panelApp = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'PanelApp.tsx'), 'utf8');
    const workspace = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'WorkspaceView.tsx'), 'utf8');
    const panelCss = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'panel.css'), 'utf8');

    assert.match(panelApp, /visibleTarget === 'workspace'[\s\S]*className="panel-prompt" aria-label="What should I say\?"/);
    assert.match(panelApp, /<span aria-hidden="true">✦<\/span> What should I say\?/);
    assert.doesNotMatch(panelApp, /panel-title[^\n]*What should I say\?/);
    assert.doesNotMatch(workspace, /workspace-prompt|What should I say/);
    assert.match(panelCss, /\.panel-prompt\s*\{[^}]*display:\s*inline-flex[^}]*background:\s*#(?:2169db|286fe0)/s);
    assert.match(workspace, /className="answer-scroll no-drag"/);
    assert.match(panelCss, /\.workspace-content\s*\{[^}]*display:\s*grid/s);
    assert.doesNotMatch(workspace, /className="workspace-toolbar no-drag"/);
    assert.match(workspace, /className="composer-actions"[\s\S]*Assist[\s\S]*\u8ffd\u95ee[\s\S]*\u91cd\u8ff0/);
    assert.match(workspace, /composer-ai-action[\s\S]*ask\('assist'\)[\s\S]*composer-ai-action[\s\S]*ask\('followup'\)[\s\S]*composer-ai-action[\s\S]*ask\('recap'\)/);
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
