import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagePath = path.join(projectRoot, 'desktop', 'package.json');
const tsconfigPath = path.join(projectRoot, 'desktop', 'tsconfig.json');
const installerScriptPath = path.join(projectRoot, 'desktop', 'build', 'installer.nsh');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));

test('electron-builder packages only the desktop runtime and explicit unsigned targets', () => {
    assert.deepEqual(pkg.build.files, ['dist/**/*', 'renderer/favicon.png', 'renderer/favicon.ico', 'package.json', '!**/*.map', '!node_modules/**/docs/**']);
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
    assert.match(installerScript, /customPageAfterChangeDir/);
    assert.match(installerScript, /customInstall/);
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

test('custom shortcut selection is wired into the assisted installer lifecycle', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    assert.doesNotMatch(installerScript, /!ifdef APP_EXECUTABLE_FILENAME/);
    assert.doesNotMatch(installerScript, /customFinishPage/);
    assert.match(installerScript, /!macro customPageAfterChangeDir[\s\S]*Page custom CreateDesktopShortcutPageCreate CreateDesktopShortcutPageLeave/);
    assert.match(installerScript, /!macro customInstall[\s\S]*CreateShortCut "\$newDesktopLink" "\$appExe"/);
    assert.match(installerScript, /WinShell::SetLnkAUMI "\$newDesktopLink" "\$\{APP_ID\}"/);
    assert.match(installerScript, /!macro customUnInstall[\s\S]*WinShell::UninstShortcut "\$oldDesktopLink"/);
});

test('shortcut page skips updates in its create callback without replacing directory sanitization', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    assert.match(installerScript, /!macro customPageAfterChangeDir\s*Page custom CreateDesktopShortcutPageCreate CreateDesktopShortcutPageLeave/);
    assert.doesNotMatch(installerScript, /!macro customPageAfterChangeDir[\s\S]*?!macroend[\s\S]*skipPageIfUpdated/);
    assert.match(installerScript, /Function CreateDesktopShortcutPageCreate\s*\$\{If\} \$\{isUpdated\}\s*Abort\s*\$\{EndIf\}/);
});

test('shortcut-page code is excluded while electron-builder compiles the uninstaller', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const installerOnlySection = installerScript.match(/!ifndef BUILD_UNINSTALLER([\s\S]*)!endif\s*!macro customUnInstall/);
    assert.ok(installerOnlySection, 'installer-only shortcut code must be guarded during uninstaller compilation');
    assert.match(installerOnlySection[1], /Var CreateDesktopShortcutCheckbox/);
    assert.match(installerOnlySection[1], /!macro customPageAfterChangeDir/);
    assert.match(installerOnlySection[1], /Function CreateDesktopShortcutPageCreate/);
    assert.match(installerOnlySection[1], /Function CreateDesktopShortcutPageLeave/);
    assert.match(installerOnlySection[1], /!macro customInstall/);
    assert.doesNotMatch(
        installerScript.replace(installerOnlySection[0], '!macro customUnInstall'),
        /CreateDesktopShortcutCheckbox|CreateDesktopShortcutState|customPageAfterChangeDir|CreateDesktopShortcutPage(Create|Leave)|customInstall/,
    );
});

test('unsigned Windows packaging skips signing without disabling executable icon editing', () => {
    const command = pkg.scripts['dist:win:unsigned'];
    assert.equal(typeof command, 'string');
    assert.match(command, /-c\.win\.signExecutable=false/);
    assert.doesNotMatch(command, /-c\.win\.signAndEditExecutable=false/);
    assert.equal(pkg.build.win.signAndEditExecutable, true);
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

test('compiles and packages the Electron main-process backend without Python service hooks', () => {
    assert.ok(pkg.build.files.includes('dist/**/*'));
    assert.equal(tsconfig.compilerOptions.rootDir, 'src');
    assert.equal(tsconfig.compilerOptions.outDir, 'dist');
    assert.ok(tsconfig.include.includes('src/**/*.ts'));

    for (const relativePath of [
        'src/backend/backend-service.ts',
        'src/backend/providers/openai-provider.ts',
        'src/backend/providers/anthropic-provider.ts',
    ]) {
        assert.ok(
            fs.statSync(path.join(projectRoot, 'desktop', relativePath)).isFile(),
            `${relativePath} must be compiled beneath dist/backend`,
        );
    }

    const packagingConfiguration = JSON.stringify(pkg.build);
    const packageScripts = JSON.stringify(pkg.scripts);
    for (const contents of [packagingConfiguration, packageScripts]) {
        assert.doesNotMatch(contents, /python(?:\.exe)?|start\.bat|server[\\/]app\.py|127\.0\.0\.1:9000|localhost:9000/i);
        assert.doesNotMatch(contents, /node:child_process|utilityProcess|\bspawn\s*\(|\bexecFile\s*\(/i);
    }
    assert.equal(pkg.build.extraResources, undefined);
    assert.equal(pkg.build.extraFiles, undefined);
});

test('production builds remove stale compiled modules before TypeScript emits', () => {
    assert.equal(
        pkg.scripts.clean,
        'node -e "require(\'node:fs\').rmSync(\'dist\',{recursive:true,force:true})"',
    );
    assert.match(pkg.scripts.build, /^npm run clean && npm run build:main && npm run build:renderer$/);
});

