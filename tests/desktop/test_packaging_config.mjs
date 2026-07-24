import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagePath = path.join(projectRoot, 'desktop', 'package.json');
const installerScriptPath = path.join(projectRoot, 'desktop', 'build', 'installer.nsh');
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'build-desktop.yml');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('electron-builder packages only the desktop runtime and explicit unsigned targets', () => {
    assert.deepEqual(pkg.build.files, ['dist/**/*', 'renderer/favicon.png', 'renderer/favicon.ico', 'package.json', '!**/*.map']);
    assert.equal(pkg.build.icon, 'renderer/favicon.png');
    assert.ok(fs.statSync(path.join(projectRoot, 'desktop', 'renderer', 'favicon.png')).size > 0);
    const windowsIcon = path.join(projectRoot, 'desktop', 'renderer', 'favicon.ico');
    assert.ok(fs.statSync(windowsIcon).size > 0);
    assert.equal(pkg.build.extraResources, undefined);
    assert.equal(pkg.build.extraFiles, undefined);
    assert.match(pkg.build.nsis.artifactName, /Setup/);
    assert.equal(pkg.build.nsis.createDesktopShortcut, false);
    assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
    assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    assert.match(installerScript, /CreateDesktopShortcutCheckbox/);
    assert.match(installerScript, /创建桌面快捷方式/);
    assert.match(installerScript, /customFinishPage/);
    assert.match(installerScript, /CreateDesktopShortcutPageLeave/);
    assert.match(installerScript, /CreateShortCut/);
    assert.equal(pkg.build.nsis.shortcutName, 'Meeting-Monster');
    assert.equal(pkg.build.nsis.installerIcon, 'renderer/favicon.ico');
    assert.equal(pkg.build.nsis.uninstallerIcon, 'renderer/favicon.ico');
    assert.match(pkg.build.portable.artifactName, /Portable/);
    assert.match(pkg.build.mac.artifactName, /Mac-Universal/);
    assert.deepEqual(pkg.build.win.target, [
        {target: 'nsis', arch: ['x64']},
        {target: 'portable', arch: ['x64']},
    ]);
    assert.equal(pkg.build.win.icon, 'renderer/favicon.ico');
    assert.deepEqual(pkg.build.mac.target, [
        {target: 'dmg', arch: ['universal']},
        {target: 'zip', arch: ['universal']},
    ]);
    assert.equal(pkg.devDependencies?.['@electron/asar'], '3.2.18');
    assert.equal(pkg.scripts['audit:package'], 'node ../tests/desktop/audit_packaged_artifact.mjs');
    assert.equal(pkg.scripts['audit:package:mac'], 'node ../tests/desktop/audit_packaged_artifact.mjs --mac');

    for (const [name, command] of Object.entries(pkg.scripts)) {
        if (name.startsWith('dist')) assert.match(command, /^npm run build &&/);
    }
});

test('packages the pinned native runtime and unpacks its platform binaries without bundling models', () => {
    assert.equal(pkg.dependencies['sherpa-onnx-node'], '1.13.4');
    assert.equal(pkg.dependencies['tar-stream'], '3.2.0');
    assert.equal(pkg.dependencies['unbzip2-stream'], '1.4.3');
    assert.deepEqual(pkg.optionalDependencies, {
        'sherpa-onnx-win-x64': '1.13.4',
        'sherpa-onnx-darwin-x64': '1.13.4',
        'sherpa-onnx-darwin-arm64': '1.13.4',
    });
    assert.ok(pkg.build.asarUnpack.some((pattern) => /sherpa-onnx-\*/.test(pattern)));
    assert.equal(pkg.build.extraResources, undefined);
    assert.equal(pkg.build.extraFiles, undefined);
});

test('Windows CI audits the Windows package and excludes non-Windows release jobs', () => {
    assert.ok(workflow.indexOf('npm --prefix desktop run audit:package') > workflow.indexOf('npm --prefix desktop run dist:win:unsigned'));
    assert.ok(workflow.indexOf('npm --prefix desktop run audit:package') < workflow.indexOf('Upload Windows artifacts'));
    assert.doesNotMatch(workflow, /dist:mac|audit:package:mac|macos:|Upload macOS artifacts/);
    assert.doesNotMatch(workflow, /sherpa-onnx-darwin/);
});
