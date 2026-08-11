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
const forbiddenPythonStartInstructions = [
    /uv\s+venv[^\n]*python/i,
    /server[\\/]requirements\.txt/i,
    /python(?:\.exe)?\s+-m\s+server\.app/i,
    /(?:^|\n)\s*(?:start|run|launch|启动|运行)\s+(?:the\s+)?Python\s+(?:server|service)/i,
];

function assertElectronDocumentationIsSafe(readme, label) {
    for (const pattern of forbiddenElectronInstructions) {
        assert.doesNotMatch(readme, pattern, `${label} must not contain forbidden Electron instructions: ${pattern}`);
    }
}

function assertReleaseDocumentationIsSafe(readme, label) {
    assert.doesNotMatch(readme, contradictoryWeightWording, `${label} must not say model weights are bundled into release artifacts`);
}

function assertDocumentationHasNoPythonLaunchInstructions(readme, label) {
    for (const pattern of forbiddenPythonStartInstructions) {
        assert.doesNotMatch(readme, pattern, `${label} must not instruct users to start Python: ${pattern}`);
    }
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

test('native backend source, package scripts, and documentation contain no Python launch hooks', () => {
    const backendRoot = path.join(desktopRoot, 'src', 'backend');
    assert.ok(fs.statSync(backendRoot).isDirectory(), 'desktop/src/backend must exist');
    const backendFiles = filesIn(backendRoot);
    assert.ok(backendFiles.some((file) => file.endsWith('.ts')), 'native backend must contain TypeScript source');

    const desktopFiles = [
        ...filesIn(path.join(desktopRoot, 'src')),
        ...filesIn(path.join(desktopRoot, 'renderer')),
        path.join(desktopRoot, 'package.json'),
        path.join(projectRoot, 'README.md'),
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

    for (const file of backendFiles) {
        const contents = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(contents, /node:child_process|\bspawn\s*\(|\bexecFile\s*\(|python(?:\.exe)?/i);
    }
});

test('legacy local HTTP settings artifacts remain removed', () => {
    for (const relativePath of [
        '.env.example',
        'desktop/src/main/desktop-settings.ts',
        'tests/desktop/test_desktop_settings.mjs',
    ]) {
        assert.equal(
            fs.existsSync(path.join(projectRoot, relativePath)),
            false,
            `${relativePath} must not return after the native backend migration`,
        );
    }

    const mainSource = fs.readFileSync(path.join(desktopRoot, 'src', 'main', 'main.ts'), 'utf8');
    assert.match(mainSource, /modelConnectionStore = new ModelConnectionStore\(\{[\s\S]*safeStorage/);
});

test('unit-test script runs the complete native backend suite', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
    const unitTest = packageJson.scripts?.['unit-test'];
    assert.equal(typeof unitTest, 'string');
    assert.match(unitTest, /(?:^|\s)tests\/desktop\/backend(?:\s|$)/);
    assert.doesNotMatch(unitTest, /backend\/types-and-validation\.test\.ts/);
    assert.doesNotMatch(unitTest, /model_test_coordinator\.test\.ts/);
});

test('official provider SDKs and Ant Design remain runtime dependencies without an SSE module', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));

    assert.match(packageJson.dependencies.openai, /.+/);
    assert.match(packageJson.dependencies['@anthropic-ai/sdk'], /.+/);
    assert.match(packageJson.dependencies.antd, /.+/);
    assert.equal(fs.existsSync(path.join(desktopRoot, 'src', 'backend', 'sse.ts')), false);
    assert.equal(fs.existsSync(path.join(desktopRoot, 'dist', 'backend', 'sse.js')), false);
    assert.equal(packageJson.devDependencies.electron, '43.3.0');
    assert.equal(packageJson.devDependencies['electron-builder'], '26.15.3');
    assert.equal(fs.existsSync(path.join(desktopRoot, 'src', 'main', 'model-test-coordinator.ts')), false);
    assert.equal(fs.existsSync(path.join(desktopRoot, 'dist', 'main', 'model-test-coordinator.js')), false);
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

test('README files describe the Electron main-process TypeScript backend boundary', () => {
    const rootReadme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
    const englishReadme = fs.readFileSync(path.join(projectRoot, 'README.en.md'), 'utf8');
    const desktopReadme = fs.readFileSync(path.join(desktopRoot, 'README.md'), 'utf8');

    assert.match(rootReadme, /浏览器工作区已移除|browser client has been removed/i);
    assert.match(rootReadme, /EXE[\s\S]{0,100}Electron 主进程[\s\S]{0,100}TypeScript 后端/i);
    assert.match(rootReadme, /不需要 Python、虚拟环境、`start\.bat` 或单独启动的本地 HTTP 服务/i);
    assert.match(rootReadme, /官方 OpenAI 和 Anthropic SDK[\s\S]{0,120}Electron 主进程[\s\S]{0,120}fetch transport/i);
    assert.match(rootReadme, /工作区菜单[\s\S]{0,120}应用隐藏/);
    assert.match(rootReadme, /本地语音转写不需要 Python ASR|no Python ASR model or LOCAL_ASR_MODEL_DIR is needed/i);
    assert.match(rootReadme, /<img[^>]+src="desktop\/renderer\/favicon\.png"/i);
    assert.ok(fs.statSync(path.join(projectRoot, 'desktop', 'renderer', 'favicon.png')).size > 0);
    assert.doesNotMatch(rootReadme, /\/api\/(?:chat|models|model-options|model-test|prompt)\/|\/ws\/asr|server\.scripts\.download_asr_model|web\/|browser_smoke|node --check web/i);
    assertDocumentationHasNoPythonLaunchInstructions(rootReadme, 'README.md');

    assert.match(englishReadme, /browser workspace has been removed/i);
    assert.match(englishReadme, /EXE or Portable app starts/i);
    assert.match(englishReadme, /TypeScript backend inside the Electron main process/i);
    assert.match(englishReadme, /no Python,[\s\S]{0,120}local HTTP service/i);
    assert.match(englishReadme, /official OpenAI and Anthropic JavaScript SDKs/i);
    assert.match(englishReadme, /<img[^>]+src="desktop\/renderer\/favicon\.png"/i);
    assertDocumentationHasNoPythonLaunchInstructions(englishReadme, 'README.en.md');

    assert.match(desktopReadme, /no browser client/i);
    assert.match(desktopReadme, /no Python WebSocket ASR path/i);
    assert.match(desktopReadme, /EXE[\s\S]{0,100}TypeScript backend[\s\S]{0,100}Electron main process/i);
    assert.match(desktopReadme, /no Python runtime[\s\S]{0,120}localhost listener[\s\S]{0,120}manually started server/i);
    assert.match(desktopReadme, /official OpenAI and Anthropic SDKs[\s\S]{0,120}main-process fetch transport/i);
    assert.match(desktopReadme, /workspace menu[\s\S]{0,120}(?:privacy|capture protection)/i);
    assert.doesNotMatch(desktopReadme, /\/api\/(?:chat|models|model-options|model-test|prompt)\/|\/ws\/asr|server\.scripts\.download_asr_model|Python ASR model|LOCAL_ASR_MODEL_DIR/i);
    assertDocumentationHasNoPythonLaunchInstructions(desktopReadme, 'desktop/README.md');
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
        assert.match(readme, /手动.*下载|manual.*download|download.*explicitly/i);
        assert.match(readme, /(?:<home>\/\.cache\/meeting-monster\/models\/asr\/<model-id>|\.cache[\\/]meeting-monster[\\/]models[\\/]asr[\\/]<model-id>)/i);
        assert.match(readme, /ModelScope.*Hugging Face|Hugging Face.*ModelScope/is);
        assert.match(readme, /固定.*SHA-256|SHA-256.*固定|pinned.*SHA-256|SHA-256.*pinned/is);
        assert.match(readme, /模型权重.*(?:不打包|不会打包).*(?:EXE).*(?:Portable).*(?:DMG).*(?:ZIP)|not bundled.*EXE.*Portable.*DMG.*ZIP/is);
        assert.match(readme, /启动.*(?:不|无).*联网.*模型|startup.*no model-network request|no model-network request.*startup/is);
        assert.match(readme, /切换.*已安装.*(?:不|不会).*下载|switching.*installed models.*does not download them again/is);
        assertReleaseDocumentationIsSafe(readme, label);
        assertElectronDocumentationIsSafe(readme, label);
    }
});

test('README documents Assist screenshots and verified image input', () => {
    const rootReadme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');

    assert.match(rootReadme, /Assist[\s\S]{0,160}不依赖转写内容或问题选择/);
    assert.match(rootReadme, /Assist[\s\S]{0,160}当前鼠标所在显示器[\s\S]{0,160}完整截图/);
    assert.match(rootReadme, /只将截图与内置分析指令发送给模型/);
    assert.match(rootReadme, /多模态模型[\s\S]{0,80}图片输入/);
    assert.match(rootReadme, /截图数据在处理期间仅以内存形式存在/);
    assert.match(rootReadme, /Electron 主进程负责截取[\s\S]{0,80}TypeScript 后端[\s\S]{0,80}模型服务/);
    assert.match(rootReadme, /不会将截图写入磁盘/);
    assert.match(rootReadme, /不传给 renderer/);
    assert.match(rootReadme, /不进入对话历史记录/);
});

test('Electron initializes the native backend without a localhost backend URL', () => {
    const mainSource = fs.readFileSync(path.join(desktopRoot, 'src', 'main', 'main.ts'), 'utf8');
    const preloadSource = fs.readFileSync(path.join(desktopRoot, 'src', 'preload', 'index.ts'), 'utf8');

    assert.match(mainSource, /new BackendService\s*\(/);
    assert.doesNotMatch(mainSource, /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i);
    assert.doesNotMatch(mainSource, /remote-api-client|RemoteApiClient|DEFAULT_BACKEND_URL|getRemoteApiClient/);
    assert.doesNotMatch(mainSource, /DesktopSettingsStore|settingsStore|APP_ADMIN_TOKEN/);
    assert.match(preloadSource, /IPC_CHANNELS\.settings\.open/);
    assert.doesNotMatch(preloadSource, /IPC_CHANNELS\.models\.(?:list|save|test|progress)|IPC_CHANNELS\.asrModels\.(?:select|download|cancel|delete)|saveConnection|clearConnection|testConnection/);
});

test('desktop and native backend expose only the two compatible LLM protocols', () => {
    const backendValidation = fs.readFileSync(
        path.join(desktopRoot, 'src', 'backend', 'validation.ts'),
        'utf8',
    );
    assert.match(backendValidation, /generic_openai/);
    assert.match(backendValidation, /generic_anthropic/);
    assert.doesNotMatch(backendValidation, /MiniMax|Moonshot|GLM|OpenRouter|Vercel|OpenCode/);

    const settingsService = fs.readFileSync(
        path.join(desktopRoot, 'ui', 'shared', 'services', 'model-settings-service.ts'),
        'utf8',
    );
    assert.match(settingsService, /OpenAI Compatible/);
    assert.match(settingsService, /Anthropic Compatible/);
    assert.doesNotMatch(settingsService, /MiniMax|Moonshot|GLM|OpenRouter|Vercel|OpenCode/);
});
