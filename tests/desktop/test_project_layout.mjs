import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const desktopRoot = path.join(projectRoot, 'desktop');

function filesIn(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? filesIn(entryPath) : [entryPath];
    });
}

const contradictoryWeightWording = /(?:models? weights?|model weights)[^\n.]{0,120}(?:\b(?:are|is|will be)\s+(?:bundled|included|packaged))/i;
const forbiddenElectronInstructions = [
    /Electron[^\n.]{0,120}(?:\b(?:should|must|need to|can|run|execute|invoke|start)\b[^\n.]{0,120}server\.scripts\.download_asr_model)/i,
    /(?:\b(?:configure|enter|set|provide|use)\b\s+(?:an?\s+|the\s+)?Electron\s+ASR\s+URL\b|\bElectron\s+ASR\s+URL\b\s*[:=]\s*(?:configure|enter|set|provide|use)\b)/i,
];

function assertElectronDocumentationIsSafe(readme, label) {
    for (const pattern of forbiddenElectronInstructions) {
        assert.doesNotMatch(readme, pattern, `${label} must not contain forbidden Electron instructions: ${pattern}`);
    }
}

function assertReleaseDocumentationIsSafe(readme, label) {
    assert.doesNotMatch(readme, contradictoryWeightWording, `${label} must not say model weights are bundled into release artifacts`);
}

test('documentation guards reject direct Electron downloader and ASR URL instructions', () => {
    for (const fixture of [
        'Electron users should run server.scripts.download_asr_model.',
        'Electron users: configure an Electron ASR URL.',
        'Electron users: enter the Electron ASR URL.',
        'Electron users: set the Electron ASR URL.',
    ]) {
        assert.throws(
            () => assertElectronDocumentationIsSafe(fixture, 'fixture'),
            /must not contain forbidden Electron instructions/,
        );
    }
});

test('documentation guards reject contradictory model-weight packaging wording', () => {
    assert.throws(
        () => assertReleaseDocumentationIsSafe('Model weights are bundled in the EXE, Portable, DMG, and ZIP.', 'fixture'),
        /must not say model weights are bundled into release artifacts/,
    );
});

test('desktop source, package scripts, and documentation do not retain local Python or ASR packaging hooks', () => {
    const desktopFiles = [
        ...filesIn(path.join(desktopRoot, 'src')),
        ...filesIn(path.join(desktopRoot, 'renderer')),
        path.join(desktopRoot, 'package.json'),
        path.join(desktopRoot, 'README.md'),
    ];
    const forbidden = [
        /server\/app\.py/i,
        /python -m server\.app/i,
        /MONSTER_OFFER_PYTHON/i,
        /MONSTER_OFFER_PROJECT_ROOT/i,
        /utilityProcess/i,
        /download_asr_model/i,
    ];

    for (const file of desktopFiles) {
        const contents = fs.readFileSync(file, 'utf8');
        for (const pattern of forbidden) {
            assert.doesNotMatch(contents, pattern, `${path.relative(projectRoot, file)} must not contain ${pattern}`);
        }
    }
});

test('ASR catalog and manager names remain in the main-process source tree', () => {
    const mainFiles = filesIn(path.join(desktopRoot, 'src', 'main'));
    const otherSourceFiles = [
        ...filesIn(path.join(desktopRoot, 'src', 'shared')),
        ...filesIn(path.join(desktopRoot, 'src', 'preload')),
        ...filesIn(path.join(desktopRoot, 'renderer')),
    ];
    assert.ok(mainFiles.some((file) => path.basename(file) === 'asr-model-catalog.ts'));
    assert.ok(mainFiles.some((file) => path.basename(file) === 'asr-model-manager.ts'));
    assert.equal(otherSourceFiles.some((file) => /asr-model-(catalog|manager)/i.test(path.basename(file))), false);
});

test('README files describe the API-only Electron boundary', () => {
    const rootReadme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
    const desktopReadme = fs.readFileSync(path.join(desktopRoot, 'README.md'), 'utf8');

    assert.match(rootReadme, /browser client has been removed/i);
    assert.match(rootReadme, /API-only.*Electron/i);
    assert.match(rootReadme, /HTTP 410/i);
    assert.match(rootReadme, /\/api\/chat\//);
    assert.match(rootReadme, /\/api\/models\//);
    assert.match(rootReadme, /\/api\/model-options\//);
    assert.match(rootReadme, /\/api\/model-test\//);
    assert.match(rootReadme, /\/api\/prompt\//);
    assert.match(rootReadme, /no Python ASR model or LOCAL_ASR_MODEL_DIR is needed/i);
    assert.doesNotMatch(rootReadme, /\/ws\/asr|server\.scripts\.download_asr_model|web\/|browser_smoke|node --check web/i);

    assert.match(desktopReadme, /no browser client/i);
    assert.match(desktopReadme, /no Python WebSocket ASR path/i);
    assert.match(desktopReadme, /\/api\/chat\//);
    assert.match(desktopReadme, /\/api\/model-options\//);
    assert.match(desktopReadme, /\/api\/model-test\//);
    assert.doesNotMatch(desktopReadme, /\/ws\/asr|server\.scripts\.download_asr_model|Python ASR model|LOCAL_ASR_MODEL_DIR/i);
});

test('README files retain Electron local ASR model and packaging requirements', () => {
    const rootReadme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
    const desktopReadme = fs.readFileSync(path.join(desktopRoot, 'README.md'), 'utf8');

    for (const [label, readme] of [
        ['README.md', rootReadme],
        ['desktop/README.md', desktopReadme],
    ]) {
        assert.match(readme, /sherpa-onnx-node/i, `${label} must identify Electron local ASR`);
        assert.match(readme, /streaming-paraformer-bilingual-zh-en/);
        assert.match(readme, /streaming-zipformer-zh-int8-2025-06-30/);
        assert.match(readme, /manual.*download|download.*explicitly/i, `${label} must require manual model download`);
        assert.match(readme, /<home>\/.cache\/meeting-monster\/models\/asr\/<model-id>\//i);
        assert.match(readme, /ModelScope.*Hugging Face|Hugging Face.*ModelScope/is);
        assert.match(readme, /pinned.*SHA-256|SHA-256.*pinned/is);
        assert.match(readme, /not bundled.*EXE.*Portable.*DMG.*ZIP/is);
        assert.match(readme, /startup.*no model-network request|no model-network request.*startup/is);
        assert.match(readme, /switching.*installed models.*does not download them again/is);
        assertReleaseDocumentationIsSafe(readme, label);
        assertElectronDocumentationIsSafe(readme, label);
    }
});

test('Electron uses the fixed local Python service and does not expose connection settings', () => {
    const mainSource = fs.readFileSync(path.join(desktopRoot, 'src', 'main', 'main.ts'), 'utf8');
    const preloadSource = fs.readFileSync(path.join(desktopRoot, 'src', 'preload', 'index.ts'), 'utf8');

    assert.match(mainSource, /DEFAULT_BACKEND_URL\s*=\s*['"]http:\/\/127\.0\.0\.1:9000\//);
    assert.doesNotMatch(mainSource, /DesktopSettingsStore|settingsStore|APP_ADMIN_TOKEN/);
    assert.doesNotMatch(preloadSource, /IPC_CHANNELS\.settings|saveConnection|clearConnection|testConnection/);
});

test('desktop and Python defaults expose only the two compatible LLM protocols', () => {
    const defaults = JSON.parse(fs.readFileSync(
        path.join(projectRoot, 'server', 'config', 'default_model_profiles.json'),
        'utf8',
    ));
    assert.deepEqual(Object.keys(defaults.profiles).sort(), ['generic_anthropic', 'generic_openai']);

    const settingsService = fs.readFileSync(
        path.join(desktopRoot, 'ui', 'shared', 'services', 'model-settings-service.ts'),
        'utf8',
    );
    assert.match(settingsService, /OpenAI Compatible/);
    assert.match(settingsService, /Anthropic Compatible/);
    assert.doesNotMatch(settingsService, /MiniMax|Moonshot|GLM|OpenRouter|Vercel|OpenCode/);
});
