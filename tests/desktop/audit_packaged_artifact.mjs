import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..', '..');
const require = createRequire(path.join(projectRoot, 'desktop', 'package.json'));
const {createPackage, listPackage} = require('@electron/asar');
const forbiddenEntry = /(?:^|\/)(?:server|web|source|python|pyinstaller|models?|asr[-_]?models?|docs|tests|\.git|\.venv)(?:\/|$)|(?:^|\/)(?:tokens\.txt|download_asr_model(?:\.[^/]+)?)(?:$|\/)|\.(?:py|pyc|onnx|pt|bin|map)$/i;
const windowsNativePackages = ['sherpa-onnx-win-x64'];
const macNativePackages = ['sherpa-onnx-darwin-x64', 'sherpa-onnx-darwin-arm64'];

function normalizeEntry(entry) {
    return entry.replaceAll('\\', '/').replace(/^\/+/, '');
}

function isAllowedAsarEntry(entry) {
    return entry === 'package.json'
        || entry === 'dist'
        || entry.startsWith('dist/')
        || entry === 'renderer'
        || entry.startsWith('renderer/')
        || entry === 'node_modules'
        || entry.startsWith('node_modules/');
}

function isAllowedUnpackedEntry(entry) {
    return entry === 'node_modules'
        || /^node_modules\/sherpa-onnx-[^/]+(?:\/|$)/i.test(entry);
}

function assertSafeEntry(entry, artifactPath, isAllowedEntry) {
    if (forbiddenEntry.test(entry)) throw new Error(`Forbidden packaged entry: ${entry} (${artifactPath})`);
    if (/sherpa-onnx-/i.test(entry) && !entry.startsWith('node_modules/sherpa-onnx-')) {
        throw new Error(`Forbidden packaged entry: ${entry} (${artifactPath})`);
    }
    if (!isAllowedEntry(entry)) throw new Error(`Unexpected packaged entry: ${entry} (${artifactPath})`);
}

function findAppAsars(directory) {
    if (!fs.existsSync(directory)) return [];
    const asarPaths = [];
    const visit = (currentDirectory) => {
        for (const directoryEntry of fs.readdirSync(currentDirectory, {withFileTypes: true})) {
            const entryPath = path.join(currentDirectory, directoryEntry.name);
            if (directoryEntry.isDirectory()) {
                visit(entryPath);
            } else if (directoryEntry.isFile() && directoryEntry.name === 'app.asar') {
                asarPaths.push(entryPath);
            }
        }
    };
    visit(directory);
    return asarPaths;
}

function listDirectoryEntries(directory) {
    if (!fs.existsSync(directory)) return [];
    const entries = [];
    const visit = (currentDirectory) => {
        for (const directoryEntry of fs.readdirSync(currentDirectory, {withFileTypes: true})) {
            const entryPath = path.join(currentDirectory, directoryEntry.name);
            const relativeEntry = normalizeEntry(path.relative(directory, entryPath));
            entries.push(relativeEntry);
            if (directoryEntry.isDirectory()) visit(entryPath);
        }
    };
    visit(directory);
    return entries;
}

function isMacArtifact(asarPath) {
    return /\/[^/]+\.app\/contents\/resources\/app\.asar$/i.test(normalizeEntry(asarPath));
}

function requireNativeRuntime(asarPath, macAudit) {
    const unpackedDirectory = `${asarPath}.unpacked`;
    if (!fs.existsSync(unpackedDirectory) || !fs.statSync(unpackedDirectory).isDirectory()) {
        throw new Error(`Expected app.asar.unpacked beside ${asarPath}`);
    }

    const requiredPackages = macAudit || isMacArtifact(asarPath) ? macNativePackages : windowsNativePackages;
    for (const packageName of requiredPackages) {
        const packageDirectory = path.join(unpackedDirectory, 'node_modules', packageName);
        if (!fs.existsSync(packageDirectory) || !fs.statSync(packageDirectory).isDirectory()) {
            throw new Error(`Expected native runtime package ${packageName} under ${unpackedDirectory}`);
        }
    }
    return unpackedDirectory;
}

export async function auditPackagedArtifact(releaseDirectory = path.join(projectRoot, 'desktop', 'release'), {mac = false} = {}) {
    const asarPaths = findAppAsars(releaseDirectory);
    if (asarPaths.length === 0) throw new Error(`Expected packaged ASAR under ${releaseDirectory}`);

    const allAsarEntries = [];
    for (const asarPath of asarPaths) {
        const entries = (await listPackage(asarPath)).map(normalizeEntry);
        for (const entry of entries) assertSafeEntry(entry, asarPath, isAllowedAsarEntry);
        const unpackedDirectory = requireNativeRuntime(asarPath, mac);
        for (const entry of listDirectoryEntries(unpackedDirectory)) {
            assertSafeEntry(entry, unpackedDirectory, isAllowedUnpackedEntry);
        }
        allAsarEntries.push(...entries);
    }
    return allAsarEntries;
}

function writeFixtureFile(root, relativePath, contents = '') {
    const filePath = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    fs.writeFileSync(filePath, contents);
}

async function createFixture(entries, {platform = 'win', unpackedEntries = []} = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-asar-'));
    const source = path.join(root, 'source');
    const release = path.join(root, 'release');
    const resourcesDirectory = platform === 'mac'
        ? path.join(release, 'mac-universal', 'Meeting-Monster.app', 'Contents', 'Resources')
        : path.join(release, 'win-unpacked', 'resources');
    const asarPath = path.join(resourcesDirectory, 'app.asar');
    for (const entry of entries) writeFixtureFile(source, entry, entry === 'package.json' ? '{}' : 'fixture');
    fs.mkdirSync(path.dirname(asarPath), {recursive: true});
    await createPackage(source, asarPath);
    for (const entry of unpackedEntries) writeFixtureFile(`${asarPath}.unpacked`, entry, 'fixture');
    return {root, release};
}

if (process.env.NODE_TEST_CONTEXT) {
    test('artifact audit fails when the Windows app ASAR is absent', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-missing-asar-'));
        try {
            await assert.rejects(auditPackagedArtifact(root), /Expected packaged ASAR/);
        } finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });

    test('artifact audit rejects a forbidden packaged fixture entry', async () => {
        const fixture = await createFixture(['package.json', 'dist/main/main.js', 'server/app.py']);
        try {
            await assert.rejects(auditPackagedArtifact(fixture.release), /Forbidden packaged entry: server(?:\/app\.py)?/);
        } finally {
            fs.rmSync(fixture.root, {recursive: true, force: true});
        }
    });

    for (const entry of [
        'dist/asr/model.onnx',
        'dist/weights/encoder.pt',
        'dist/weights/decoder.bin',
        'renderer/helper.py',
        'dist/.venv/config',
    ]) {
        test(`artifact audit rejects ${entry} under an allowed root`, async () => {
            const fixture = await createFixture(
                ['package.json', 'dist/main/main.js', entry],
                {unpackedEntries: ['node_modules/sherpa-onnx-win-x64/sherpa-onnx.node']},
            );
            try {
                await assert.rejects(auditPackagedArtifact(fixture.release), /Forbidden packaged entry/);
            } finally {
                fs.rmSync(fixture.root, {recursive: true, force: true});
            }
        });
    }

    for (const entry of [
        'dist/source/main.js',
        'renderer/SoUrCe/helper.js',
        'renderer/cache/module.pyc',
        'dist/PyInstaller/bootstrap.js',
        'renderer/python/launcher.js',
        'dist/web/index.html',
        'renderer/models/profile.json',
        'dist/docs/guide.txt',
        'renderer/tests/spec.js',
        'dist/.git/config',
        'renderer/bundle.map',
        'dist/sherpa-onnx-node/index.js',
        'renderer/download_asr_model.js',
    ]) {
        test(`artifact audit rejects the forbidden path ${entry}`, async () => {
            const fixture = await createFixture(['package.json', 'dist/main/main.js', entry]);
            try {
                await assert.rejects(auditPackagedArtifact(fixture.release), /Forbidden packaged entry/);
            } finally {
                fs.rmSync(fixture.root, {recursive: true, force: true});
            }
        });
    }

    test('artifact audit permits JavaScript and CSS runtime fixture entries', async () => {
        const fixture = await createFixture(
            ['package.json', 'dist/main/main.js', 'renderer/overlay.css'],
            {unpackedEntries: ['node_modules/sherpa-onnx-win-x64/sherpa-onnx.node']},
        );
        try {
            assert.deepEqual((await auditPackagedArtifact(fixture.release)).sort(), [
                'dist', 'dist/main', 'dist/main/main.js', 'package.json', 'renderer', 'renderer/overlay.css',
            ]);
        } finally {
            fs.rmSync(fixture.root, {recursive: true, force: true});
        }
    });

    test('artifact audit permits native addon files but rejects model content', async () => {
        const nativeFixture = await createFixture(
            ['package.json', 'dist/main/main.js', 'node_modules/sherpa-onnx-win-x64/sherpa-onnx.node'],
            {unpackedEntries: ['node_modules/sherpa-onnx-win-x64/sherpa-onnx.node']},
        );
        const modelFixture = await createFixture(['package.json', 'dist/main/main.js', 'dist/models/asr/encoder.onnx']);
        try {
            await assert.doesNotReject(auditPackagedArtifact(nativeFixture.release));
            await assert.rejects(auditPackagedArtifact(modelFixture.release), /Forbidden packaged entry/);
        } finally {
            fs.rmSync(nativeFixture.root, {recursive: true, force: true});
            fs.rmSync(modelFixture.root, {recursive: true, force: true});
        }
    });

    test('artifact audit recursively inspects macOS ASARs and their unpacked native runtime', async () => {
        const fixture = await createFixture(
            ['package.json', 'dist/main/main.js'],
            {
                platform: 'mac',
                unpackedEntries: [
                    'node_modules/sherpa-onnx-darwin-x64/sherpa-onnx.node',
                    'node_modules/sherpa-onnx-darwin-arm64/sherpa-onnx.node',
                ],
            },
        );
        try {
            await assert.doesNotReject(auditPackagedArtifact(fixture.release));
        } finally {
            fs.rmSync(fixture.root, {recursive: true, force: true});
        }
    });

    test('artifact audit rejects model tokens from app.asar.unpacked', async () => {
        const fixture = await createFixture(
            ['package.json', 'dist/main/main.js'],
            {unpackedEntries: ['node_modules/sherpa-onnx-win-x64/models/asr/tokens.txt']},
        );
        try {
            await assert.rejects(auditPackagedArtifact(fixture.release), /Forbidden packaged entry/);
        } finally {
            fs.rmSync(fixture.root, {recursive: true, force: true});
        }
    });

    test('artifact audit requires an unpacked native runtime sibling for Windows artifacts', async () => {
        const fixture = await createFixture(['package.json', 'dist/main/main.js']);
        try {
            await assert.rejects(auditPackagedArtifact(fixture.release), /Expected app\.asar\.unpacked/);
        } finally {
            fs.rmSync(fixture.root, {recursive: true, force: true});
        }
    });

    test('artifact audit requires both native architectures for macOS artifacts', async () => {
        const fixture = await createFixture(
            ['package.json', 'dist/main/main.js'],
            {
                platform: 'mac',
                unpackedEntries: ['node_modules/sherpa-onnx-darwin-arm64/sherpa-onnx.node'],
            },
        );
        try {
            await assert.rejects(auditPackagedArtifact(fixture.release), /sherpa-onnx-darwin-x64/);
        } finally {
            fs.rmSync(fixture.root, {recursive: true, force: true});
        }
    });

    test('artifact audit macOS mode requires both native architectures regardless of artifact layout', async () => {
        const fixture = await createFixture(
            ['package.json', 'dist/main/main.js'],
            {unpackedEntries: ['node_modules/sherpa-onnx-win-x64/sherpa-onnx.node']},
        );
        try {
            await assert.rejects(auditPackagedArtifact(fixture.release, {mac: true}), /sherpa-onnx-darwin-x64/);
        } finally {
            fs.rmSync(fixture.root, {recursive: true, force: true});
        }
    });

    test('artifact audit CLI resolves a relative release directory from desktop', async () => {
        const fixture = await createFixture(
            ['package.json', 'dist/main/main.js'],
            {unpackedEntries: ['node_modules/sherpa-onnx-win-x64/sherpa-onnx.node']},
        );
        const releaseName = `audit-cli-${path.basename(fixture.root)}`;
        const releaseDirectory = path.join(projectRoot, 'desktop', releaseName);
        try {
            fs.cpSync(fixture.release, releaseDirectory, {recursive: true});
            const environment = {...process.env, MEETING_MONSTER_RELEASE_DIR: releaseName};
            delete environment.NODE_TEST_CONTEXT;
            const result = spawnSync(process.execPath, [scriptPath], {
                encoding: 'utf8',
                env: environment,
            });
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /Packaged artifact audit passed \(4 ASAR entries\)\./);
        } finally {
            fs.rmSync(releaseDirectory, {recursive: true, force: true});
            fs.rmSync(fixture.root, {recursive: true, force: true});
        }
    });
}

if (!process.env.NODE_TEST_CONTEXT && process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    const macAudit = process.argv.includes('--mac');
    const configuredReleaseDirectory = process.env.MEETING_MONSTER_RELEASE_DIR;
    const resolvedRelease = configuredReleaseDirectory
        ? (path.isAbsolute(configuredReleaseDirectory)
            ? configuredReleaseDirectory
            : path.join(projectRoot, 'desktop', configuredReleaseDirectory))
        : path.join(projectRoot, 'desktop', 'release');
    auditPackagedArtifact(resolvedRelease, {mac: macAudit})
        .then((entries) => {
            console.log(`Packaged ${macAudit ? 'macOS ' : ''}artifact audit passed (${entries.length} ASAR entries).`);
            console.log(entries.join('\n'));
        })
        .catch((error) => {
            console.error(`Packaged artifact audit failed: ${error.message}`);
            process.exitCode = 1;
        });
}
