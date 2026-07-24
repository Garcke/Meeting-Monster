import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MANAGER_MODULE = '../../desktop/dist/main/asr-model-manager.js';
const PARA = 'streaming-paraformer-bilingual-zh-en';
const ZIP = 'streaming-zipformer-zh-int8-2025-06-30';
const bytes = Buffer.from('test');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

function tinyCatalog({badHash = false} = {}) {
    return [{
        id: PARA, label: 'Paraformer', languages: ['zh'], description: 'test', estimatedBytes: bytes.length,
        kind: 'online-paraformer', requiredFiles: ['encoder.int8.onnx'], supportsHotwords: false,
        modelingUnit: 'cjkchar', sherpa: {}, endpoint: {},
        sources: [
            {provider: 'modelscope', kind: 'files', repository: 'fixed/a', revision: 'fixed', urlRoot: 'https://modelscope.cn/models/fixed/a/resolve/fixed', files: [{name: 'encoder.int8.onnx', bytes: bytes.length, sha256: badHash ? '0'.repeat(64) : sha256}]},
            {provider: 'huggingface', kind: 'files', repository: 'fixed/b', revision: 'fixed', urlRoot: 'https://huggingface.co/fixed/b/resolve/fixed', files: [{name: 'encoder.int8.onnx', bytes: bytes.length, sha256}]},
        ],
    }, {
        id: ZIP, label: 'Zipformer', languages: ['zh'], description: 'test', estimatedBytes: bytes.length,
        kind: 'online-transducer', requiredFiles: ['encoder.int8.onnx'], supportsHotwords: false,
        modelingUnit: 'cjkchar', sherpa: {}, endpoint: {}, sources: [],
    }];
}

async function createHarness({staleStaging = false, failFirst = false, badHash = false, installedZipformer = false, installedParaformer = false, current = PARA, getFreeBytes} = {}) {
    const {AsrModelManager} = await import(MANAGER_MODULE);
    const modelRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-asr-')), 'cache', 'meeting-monster', 'models', 'asr');
    const requests = [];
    const catalog = tinyCatalog({badHash});
    const manager = new AsrModelManager({
        modelRoot, catalog, defaultModelId: PARA, getFreeBytes: getFreeBytes ?? (async () => 100 * 1024 * 1024),
        downloadSource: async (source, signal, onProgress) => {
            requests.push(source);
            if (failFirst && source.provider === 'modelscope') throw Object.assign(new Error('network failed'), {code: 'ECONNRESET'});
            if (signal.aborted) throw signal.reason;
            onProgress(bytes.length, bytes.length);
            return new Map([['encoder.int8.onnx', bytes]]);
        },
    });
    const modelPath = manager.getModelDirectory(PARA);
    const stagingPath = manager.getStagingDirectory(PARA);
    if (staleStaging) { fs.mkdirSync(stagingPath, {recursive: true}); fs.writeFileSync(path.join(stagingPath, 'old'), 'x'); }
    if (installedZipformer) { fs.mkdirSync(manager.getModelDirectory(ZIP), {recursive: true}); fs.writeFileSync(path.join(manager.getModelDirectory(ZIP), 'encoder.int8.onnx'), bytes); }
    if (installedParaformer) { fs.mkdirSync(manager.getModelDirectory(PARA), {recursive: true}); fs.writeFileSync(path.join(manager.getModelDirectory(PARA), 'encoder.int8.onnx'), bytes); }
    fs.mkdirSync(modelRoot, {recursive: true});
    fs.writeFileSync(path.join(modelRoot, 'current-model.json'), JSON.stringify({currentModelId: current}));
    await manager.initialize();
    return {manager, requests, modelRoot, modelPath, stagingPath, get snapshot() { return manager.snapshot; }};
}

test('initialize cleans stale staging without making a network request', async () => {
    const harness = await createHarness({staleStaging: true});
    assert.equal(harness.requests.length, 0);
    assert.equal(fs.existsSync(harness.stagingPath), false);
    assert.equal(harness.snapshot.currentModelId, PARA);
});

test('download requests ModelScope before fixed Hugging Face fallback and emits byte totals', async () => {
    const harness = await createHarness({failFirst: true, current: ZIP});
    const progress = []; harness.manager.subscribe((snapshot) => progress.push(snapshot));
    await harness.manager.download(PARA);
    assert.deepEqual(harness.requests.map((request) => request.provider), ['modelscope', 'huggingface']);
    assert.equal(progress.at(-1).models[0].state, 'installed');
    assert.equal(progress.some((item) => item.models[0].downloadedBytes === 4), true);
    assert.equal(harness.snapshot.currentModelId, PARA);
});

test('manager accepts a downloader that verifies files directly in the supplied staging directory', async () => {
    const harness = await createHarness();
    const originalDownloadSource = harness.manager.downloadSource;
    harness.manager.downloadSource = async (source, signal, onProgress, stagingDirectory) => {
        assert.equal(typeof stagingDirectory, 'string');
        fs.mkdirSync(stagingDirectory, {recursive: true});
        fs.writeFileSync(path.join(stagingDirectory, source.files[0].name), bytes);
        onProgress(bytes.length, bytes.length);
        return {staged: true};
    };
    try {
        await harness.manager.download(PARA);
        assert.deepEqual(fs.readdirSync(harness.modelPath), ['encoder.int8.onnx']);
    } finally {
        harness.manager.downloadSource = originalDownloadSource;
    }
});

test('size or hash failure never installs and removes only this staging directory', async () => {
    const harness = await createHarness({badHash: true});
    await assert.rejects(harness.manager.download(PARA), /checksum/i);
    assert.equal(fs.existsSync(harness.modelPath), false); assert.equal(fs.existsSync(harness.stagingPath), false);
});

test('unknown IDs and traversal-shaped IDs are rejected before filesystem access', async () => {
    const harness = await createHarness();
    await assert.rejects(harness.manager.download('../outside'), /Unknown ASR model/);
    await assert.rejects(harness.manager.delete('file:///outside'), /Unknown ASR model/);
});

test('deleting the current model restores Paraformer selection without downloading it', async () => {
    const harness = await createHarness({installedZipformer: true, current: ZIP});
    await harness.manager.delete(ZIP);
    assert.equal(harness.snapshot.currentModelId, PARA); assert.equal(harness.requests.length, 0);
    assert.equal(harness.snapshot.models[0].state, 'not-downloaded');
});

test('cancellation removes staging, leaves the model retryable, and does not mark it failed', async () => {
    const harness = await createHarness();
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await assert.rejects(harness.manager.download(PARA, controller.signal), /cancelled/i);
    assert.equal(fs.existsSync(harness.stagingPath), false); assert.equal(harness.snapshot.models[0].state, 'not-downloaded');
    await harness.manager.download(PARA);
    assert.equal(harness.snapshot.models[0].state, 'installed');
});

test('archive traversal entries are rejected before writing files', async () => {
    const extractor = await import('../../desktop/dist/main/asr-archive-extractor.js');
    assert.throws(() => extractor.validateArchiveEntry('../escape', 'file', ['encoder.int8.onnx']), /archive entry/i);
});

test('archive validator ignores safe macOS metadata entries', async () => {
    const extractor = await import('../../desktop/dist/main/asr-archive-extractor.js');
    for (const name of ['._sherpa-onnx-streaming-paraformer-bilingual-zh-en', '.DS_Store', '__MACOSX/._metadata']) {
        assert.equal(extractor.validateArchiveEntry(name, 'file', ['encoder.int8.onnx']), null);
    }
});

test('archive validator strips the fixed top-level model directory', async () => {
    const extractor = await import('../../desktop/dist/main/asr-archive-extractor.js');
    const root = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en';
    const requiredFiles = ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'];
    assert.equal(extractor.validateArchiveEntry(`${root}/`, 'directory', requiredFiles, root), null);
    assert.equal(extractor.validateArchiveEntry(`${root}/encoder.int8.onnx`, 'file', requiredFiles, root), 'encoder.int8.onnx');
    assert.throws(() => extractor.validateArchiveEntry('other-root/encoder.int8.onnx', 'file', requiredFiles, root), /archive entry/i);
});

test('nested Node fetch network causes use the fixed Hugging Face fallback', async () => {
    const harness = await createHarness();
    harness.manager.downloadSource = async (source, signal, onProgress) => {
        harness.requests.push(source);
        if (source.provider === 'modelscope') throw Object.assign(new Error('fetch failed'), {cause: {code: 'ENOTFOUND'}});
        onProgress(bytes.length, bytes.length); return new Map([['encoder.int8.onnx', bytes]]);
    };
    await harness.manager.download(PARA);
    assert.deepEqual(harness.requests.map((source) => source.provider), ['modelscope', 'huggingface']);
});

test('fallback checks its own manifest free-space requirement before requesting it', async () => {
    const minimum = 32 * 1024 * 1024 + bytes.length;
    const harness = await createHarness({getFreeBytes: async () => minimum});
    const catalog = harness.manager.catalog;
    catalog[0].sources[1].files[0].bytes = bytes.length + 1;
    harness.manager.downloadSource = async (source) => {
        harness.requests.push(source);
        throw Object.assign(new Error('fetch failed'), {cause: {code: 'ECONNRESET'}});
    };
    await assert.rejects(harness.manager.download(PARA), /Insufficient free space: required .* available/);
    assert.deepEqual(harness.requests.map((source) => source.provider), ['modelscope']);
});

test('a complete installed directory is reused and becomes current without a request', async () => {
    const harness = await createHarness({installedParaformer: true, current: ZIP});
    await harness.manager.download(PARA);
    assert.equal(harness.requests.length, 0);
    assert.equal(harness.snapshot.currentModelId, PARA);
    assert.equal(harness.snapshot.models[0].state, 'installed');
});

test('selectModel permits only installed fixed IDs and persists the current selection', async () => {
    const harness = await createHarness({installedZipformer: true});
    await harness.manager.selectModel(ZIP);
    assert.equal(harness.snapshot.currentModelId, ZIP);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(harness.modelRoot, 'current-model.json'), 'utf8')), {currentModelId: ZIP});
    await assert.rejects(harness.manager.selectModel(PARA), /not installed/i);
    await assert.rejects(harness.manager.selectModel('../outside'), /Unknown ASR model/);
});

test('in-flight cancellation cleans up when the downloader observes an abort', async () => {
    const harness = await createHarness();
    let started; const downloaderStarted = new Promise((resolve) => { started = resolve; });
    harness.manager.downloadSource = async (_source, signal) => new Promise((_, reject) => {
        started();
        signal.addEventListener('abort', () => reject(new Error('cancelled during download')), {once: true});
    });
    const controller = new AbortController(); const pending = harness.manager.download(PARA, controller.signal);
    await downloaderStarted; controller.abort(); await assert.rejects(pending, /cancelled/i);
    assert.equal(fs.existsSync(harness.stagingPath), false);
});

test('archive validator rejects absolute paths and every non-file entry type', async () => {
    const extractor = await import('../../desktop/dist/main/asr-archive-extractor.js');
    for (const [name, type] of [['/escape', 'file'], ['C:\\escape', 'file'], ['encoder.int8.onnx', 'directory'], ['encoder.int8.onnx', 'symlink'], ['encoder.int8.onnx', 'link'], ['encoder.int8.onnx', 'character-device']]) {
        assert.throws(() => extractor.validateArchiveEntry(name, type, ['encoder.int8.onnx']), /archive entry/i);
    }
});

test('manual redirects reject credentials before following them', async () => {
    const {createFetchDownloadSource} = await import(MANAGER_MODULE);
    let calls = 0;
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-asr-staging-'));
    const download = createFetchDownloadSource(async () => {
        calls += 1;
        return new Response(null, {status: 302, headers: {location: 'https://user:password@huggingface.co/fixed/b/resolve/fixed?signature=no'}});
    });
    try {
        await assert.rejects(download(tinyCatalog()[0].sources[1], new AbortController().signal, () => {}, staging), /allowed fixed HTTPS source/);
        assert.equal(calls, 1);
    } finally {
        fs.rmSync(staging, {recursive: true, force: true});
    }
});

test('ModelScope redirects accept its signed CDN query parameters and stream into staging', async () => {
    const {createFetchDownloadSource} = await import(MANAGER_MODULE);
    const source = {...tinyCatalog()[0].sources[0], kind: 'archive', files: [{name: 'model.tar.bz2', bytes: bytes.length, sha256}]};
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-asr-staging-'));
    const calls = [];
    const progress = [];
    const download = createFetchDownloadSource(async (url) => {
        calls.push(String(url));
        if (calls.length === 1) return new Response(null, {status: 302, headers: {location: 'https://cdn-lfs-cn-1.modelscope.cn/objects/encoder.int8.onnx?Expires=123&Signature=signed'}});
        return new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(Uint8Array.from([116]));
                controller.enqueue(Uint8Array.from([101, 115, 116]));
                controller.close();
            },
        }), {status: 200});
    });
    try {
        const payload = await download(source, new AbortController().signal, (done) => progress.push(done), staging);
        assert.deepEqual(payload, {staged: true});
        assert.deepEqual(progress, [1, 4]);
        assert.deepEqual(fs.readdirSync(staging), ['.archive.part']);
        assert.deepEqual(fs.readFileSync(path.join(staging, '.archive.part')), bytes);
        assert.match(calls[1], /^https:\/\/cdn-lfs-cn-1\.modelscope\.cn\/.*\?/);
    } finally {
        fs.rmSync(staging, {recursive: true, force: true});
    }
});

test('Hugging Face redirects accept its signed CDN query parameters', async () => {
    const {createFetchDownloadSource} = await import(MANAGER_MODULE);
    const source = tinyCatalog()[0].sources[1];
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-asr-staging-'));
    let calls = 0;
    const download = createFetchDownloadSource(async () => {
        calls += 1;
        if (calls === 1) return new Response(null, {status: 302, headers: {location: 'https://us.aws.cdn.hf.co/objects/encoder.int8.onnx?X-Amz-Signature=signed'}});
        return new Response(bytes, {status: 200});
    });
    try {
        const payload = await download(source, new AbortController().signal, () => {}, staging);
        assert.deepEqual(payload, {staged: true});
        assert.equal(calls, 2);
    } finally {
        fs.rmSync(staging, {recursive: true, force: true});
    }
});

test('provider redirects cannot cross to another provider host', async () => {
    const {createFetchDownloadSource} = await import(MANAGER_MODULE);
    const source = tinyCatalog()[0].sources[0];
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-asr-staging-'));
    let calls = 0;
    const download = createFetchDownloadSource(async () => {
        calls += 1;
        return new Response(null, {status: 302, headers: {location: 'https://huggingface.co/fixed/b/resolve/fixed'}});
    });
    try {
        await assert.rejects(download(source, new AbortController().signal, () => {}, staging), /allowed fixed HTTPS source/);
        assert.equal(calls, 1);
    } finally {
        fs.rmSync(staging, {recursive: true, force: true});
    }
});

test('default downloader never calls arrayBuffer and reports incremental progress while writing a part', async () => {
    const {createFetchDownloadSource} = await import(MANAGER_MODULE);
    const source = tinyCatalog()[0].sources[1];
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-asr-staging-'));
    const progress = [];
    const download = createFetchDownloadSource(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: new ReadableStream({
            start(controller) {
                controller.enqueue(Uint8Array.from([116]));
                controller.enqueue(Uint8Array.from([101, 115]));
                controller.enqueue(Uint8Array.from([116]));
                controller.close();
            },
        }),
        async arrayBuffer() { throw new Error('arrayBuffer must not be used for model downloads'); },
    }));
    try {
        const payload = await download(source, new AbortController().signal, (done) => progress.push(done), staging);
        assert.deepEqual(payload, {staged: true});
        assert.deepEqual(progress, [1, 3, 4]);
        assert.deepEqual(fs.readdirSync(staging), ['encoder.int8.onnx']);
        assert.equal(fs.existsSync(path.join(staging, 'encoder.int8.onnx.part')), false);
    } finally {
        fs.rmSync(staging, {recursive: true, force: true});
    }
});

test('failed backup removal restores the previous final directory', async () => {
    const harness = await createHarness({installedParaformer: true});
    fs.writeFileSync(path.join(harness.modelPath, 'encoder.int8.onnx'), Buffer.from('old!'));
    fs.writeFileSync(path.join(harness.modelPath, 'old-marker'), 'previous install');
    const originalRm = fs.promises.rm;
    fs.promises.rm = async (target, options) => {
        if (String(target).includes('.backup-')) throw new Error('backup removal failed');
        return originalRm(target, options);
    };
    try { await assert.rejects(harness.manager.download(PARA), /backup removal failed/); }
    finally { fs.promises.rm = originalRm; }
    assert.deepEqual(fs.readFileSync(path.join(harness.modelPath, 'encoder.int8.onnx')), Buffer.from('old!'));
    assert.equal(fs.readFileSync(path.join(harness.modelPath, 'old-marker'), 'utf8'), 'previous install');
});

test('cancel aborts only the active fixed model download and cleans staging', async () => {
    const harness = await createHarness();
    let started; const downloaderStarted = new Promise((resolve) => { started = resolve; });
    let observedAbort = false;
    harness.manager.downloadSource = async (_source, signal) => new Promise((_, reject) => {
        started(); signal.addEventListener('abort', () => { observedAbort = true; reject(new Error('cancelled by manager')); }, {once: true});
    });
    const pending = harness.manager.download(PARA);
    await downloaderStarted;
    assert.equal(harness.manager.cancel(PARA), true);
    await assert.rejects(pending, /cancelled/i);
    assert.equal(observedAbort, true); assert.equal(fs.existsSync(harness.stagingPath), false);
    assert.equal(harness.manager.cancel('../outside'), false);
});

test('delete rejects while the same fixed model download is active', async () => {
    const harness = await createHarness();
    let started; const downloaderStarted = new Promise((resolve) => { started = resolve; });
    harness.manager.downloadSource = async (_source, signal) => new Promise((_, reject) => {
        started(); signal.addEventListener('abort', () => reject(new Error('cancelled after delete rejection')), {once: true});
    });
    const pending = harness.manager.download(PARA);
    await downloaderStarted;
    await assert.rejects(harness.manager.delete(PARA), /active download/i);
    assert.equal(harness.manager.cancel(PARA), true);
    await assert.rejects(pending, /cancelled/i);
    assert.equal(fs.existsSync(harness.stagingPath), false);
});

test('concurrent selections serialize atomic current-model persistence', async () => {
    const harness = await createHarness({installedParaformer: true, installedZipformer: true});
    await Promise.all([harness.manager.selectModel(PARA), harness.manager.selectModel(ZIP)]);
    const saved = JSON.parse(fs.readFileSync(path.join(harness.modelRoot, 'current-model.json'), 'utf8'));
    assert.equal(saved.currentModelId, harness.snapshot.currentModelId);
    assert.equal(fs.existsSync(path.join(harness.modelRoot, 'current-model.json.tmp')), false);
});

test('symlinked required files are not reused as installed models', async (t) => {
    const harness = await createHarness({installedParaformer: true});
    const target = path.join(harness.modelRoot, '..', '..', '..', 'outside-file');
    fs.writeFileSync(target, bytes); fs.rmSync(path.join(harness.modelPath, 'encoder.int8.onnx'));
    try { fs.symlinkSync(target, path.join(harness.modelPath, 'encoder.int8.onnx'), 'file'); }
    catch (error) { if (error.code === 'EPERM') { t.skip('Windows symlink privilege is unavailable'); return; } throw error; }
    await harness.manager.download(PARA);
    assert.equal(harness.requests.length, 1);
    assert.equal(fs.lstatSync(path.join(harness.modelPath, 'encoder.int8.onnx')).isSymbolicLink(), false);
});
