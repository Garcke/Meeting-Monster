import test from 'node:test';
import assert from 'node:assert/strict';

const ENGINE_MODULE = '../../desktop/dist/main/local-asr-engine.js';
const PARA = 'streaming-paraformer-bilingual-zh-en';
const ZIP = 'streaming-zipformer-zh-int8-2025-06-30';

function createRecognizerHarness({endpoint = false, failNext = false, failStart = false, failDecode = false, failStop = false, disposeOnly = false, results = []} = {}) {
    const harness = {config: undefined, recognizer: undefined, recognizers: [], stream: undefined, resampler: undefined};
    class OnlineRecognizer {
        constructor(config) {
            if (failNext) throw new Error('native construction detail');
            harness.config = config; harness.recognizer = this; harness.recognizers.push(this); this.disposed = false; this.resetCalls = [];
        }
        createStream() {
            if (failStart) throw new Error('native start detail');
            const stream = {
                waveforms: [],
                acceptWaveform(waveform) {
                    if (arguments.length !== 1 || !(waveform.samples instanceof Float32Array) || typeof waveform.sampleRate !== 'number') throw new Error('real API requires waveform object');
                    this.waveforms.push(waveform);
                    if (failStop && waveform.samples.length === 6400) throw new Error('native stop detail');
                },
            };
            harness.stream = stream;
            return stream;
        }
        isReady() { return results.length > 0; }
        decode() { if (failDecode) throw new Error('native decode detail'); }
        getResult() { return {text: results.shift() ?? ''}; }
        isEndpoint() { return endpoint; }
        reset(stream) { this.resetCalls.push(stream); }
        free() { this.disposed = true; }
        dispose() { this.disposed = true; }
    }
    class LinearResampler {
        constructor(inputRate, outputRate) { this.inputRate = inputRate; this.outputRate = outputRate; this.flushCalls = []; harness.resampler = this; }
        resample(samples) { return samples; }
        flush(samples) { this.flushCalls.push(samples); return new Float32Array([0.25]); }
    }
    harness.binding = {OnlineRecognizer, LinearResampler};
    if (disposeOnly) delete OnlineRecognizer.prototype.free;
    return harness;
}

async function createReadyEngine(harness, modelId = PARA) {
    const {LocalAsrEngine} = await import(ENGINE_MODULE);
    const engine = new LocalAsrEngine({binding: harness.binding, resolveModelDirectory: () => modelId === PARA ? 'C:/models/paraformer' : 'C:/models/zipformer'});
    await engine.load(modelId);
    return engine;
}

function assertCommonConfig(config, directory) {
    assert.equal(config.featConfig.sampleRate, 16000);
    assert.equal(config.featConfig.featureDim, 80);
    assert.equal(config.modelConfig.tokens.replace(/\\/g, '/'), `${directory}/tokens.txt`);
    assert.equal(config.modelConfig.numThreads, 2);
    assert.equal(config.modelConfig.provider, 'cpu');
    assert.equal(config.modelConfig.debug, 0);
    assert.equal(config.decodingMethod, 'greedy_search');
    assert.equal(config.maxActivePaths, 4);
    assert.equal(config.enableEndpoint, true);
    assert.equal(config.rule1MinTrailingSilence, 2.4);
    assert.equal(config.rule2MinTrailingSilence, 1.2);
    assert.equal(config.rule3MinUtteranceLength, 20);
}

test('Paraformer load creates the complete fixed streaming configuration', async () => {
    const harness = createRecognizerHarness();
    const {LocalAsrEngine} = await import(ENGINE_MODULE);
    const engine = new LocalAsrEngine({binding: harness.binding, resolveModelDirectory: () => 'C:/models/paraformer'});
    await engine.load(PARA);
    assertCommonConfig(harness.config, 'C:/models/paraformer');
    assert.match(harness.config.modelConfig.paraformer.encoder, /C:[\\/]models[\\/]paraformer[\\/]encoder\.int8\.onnx$/);
    assert.match(harness.config.modelConfig.paraformer.decoder, /C:[\\/]models[\\/]paraformer[\\/]decoder\.int8\.onnx$/);
});

test('Zipformer load creates the fixed transducer configuration', async () => {
    const harness = createRecognizerHarness();
    const engine = await createReadyEngine(harness, ZIP);
    assertCommonConfig(harness.config, 'C:/models/zipformer');
    assert.match(harness.config.modelConfig.transducer.encoder, /C:[\\/]models[\\/]zipformer[\\/]encoder\.int8\.onnx$/);
    assert.match(harness.config.modelConfig.transducer.decoder, /C:[\\/]models[\\/]zipformer[\\/]decoder\.onnx$/);
    assert.match(harness.config.modelConfig.transducer.joiner, /C:[\\/]models[\\/]zipformer[\\/]joiner\.int8\.onnx$/);
    assert.equal(engine.getStatus().state, 'ready');
});

test('PCM uses the real object waveform shape and produces changed partial text', async () => {
    const harness = createRecognizerHarness({results: ['first', 'first']});
    const engine = await createReadyEngine(harness);
    const events = [];
    engine.onResult((event) => events.push(event));
    await engine.start(16000);
    engine.acceptPcm(new Int16Array([-32768, 0, 32767]));
    assert.equal(harness.stream.waveforms[0].sampleRate, 16000);
    assert.deepEqual(Array.from(harness.stream.waveforms[0].samples), [-1, 0, 1]);
    assert.deepEqual(events, [{type: 'partial', text: 'first'}]);
});

test('stop flushes the resampler tail before 16kHz silence drain', async () => {
    const harness = createRecognizerHarness();
    const engine = await createReadyEngine(harness);
    await engine.start(48000);
    engine.acceptPcm(new Int16Array([0]));
    await engine.stop();
    assert.deepEqual(harness.resampler.flushCalls.map((samples) => Array.from(samples)), [[]]);
    assert.equal(harness.stream.waveforms[1].sampleRate, 16000);
    assert.deepEqual(Array.from(harness.stream.waveforms[1].samples), [0.25]);
    assert.equal(harness.stream.waveforms[2].sampleRate, 16000);
    assert.equal(harness.stream.waveforms[2].samples.length, 6400);
});

test('endpoint uses recognizer reset and stop emits the final once', async () => {
    const harness = createRecognizerHarness({endpoint: true, results: ['hello']});
    const engine = await createReadyEngine(harness);
    const events = [];
    engine.onResult((event) => events.push(event));
    await engine.start(16000);
    engine.acceptPcm(new Int16Array([1, 2]));
    await engine.stop();
    assert.deepEqual(events, [{type: 'partial', text: 'hello'}, {type: 'final', text: 'hello'}]);
    assert.deepEqual(harness.recognizer.resetCalls, [harness.stream]);
});

test('dispose stops an active stream before releasing the recognizer', async () => {
    const harness = createRecognizerHarness({results: ['hello']});
    const engine = await createReadyEngine(harness);
    const events = [];
    engine.onResult((event) => events.push(event));
    await engine.start(16000);
    engine.acceptPcm(new Int16Array([1]));
    engine.dispose();
    assert.equal(harness.stream.waveforms.length, 2);
    assert.deepEqual(events, [{type: 'partial', text: 'hello'}, {type: 'final', text: 'hello'}]);
    assert.equal(harness.recognizer.disposed, true);
});

test('release calls dispose when a recognizer has no free method', async () => {
    const harness = createRecognizerHarness({disposeOnly: true});
    const engine = await createReadyEngine(harness);
    engine.dispose();
    assert.equal(harness.recognizer.disposed, true);
});

test('loading a replacement while recording finalizes and releases the old stream', async () => {
    const harness = createRecognizerHarness({results: ['old text']});
    const engine = await createReadyEngine(harness);
    const events = [];
    engine.onResult((event) => events.push(event));
    await engine.start(48000);
    engine.acceptPcm(new Int16Array([1]));
    const oldRecognizer = harness.recognizer;
    const oldStream = harness.stream;
    const oldResampler = harness.resampler;
    await engine.load(ZIP);
    assert.deepEqual(events, [{type: 'partial', text: 'old text'}, {type: 'final', text: 'old text'}]);
    assert.deepEqual(oldResampler.flushCalls.map((samples) => Array.from(samples)), [[]]);
    assert.equal(oldStream.waveforms.at(-1).samples.length, 6400);
    assert.equal(oldRecognizer.disposed, true);
    assert.equal(harness.recognizers.length, 2);
    assert.equal(engine.getStatus().state, 'ready');
});

test('native failures expose only the required Chinese messages', async () => {
    const unavailable = createRecognizerHarness({failNext: true});
    const {LocalAsrEngine} = await import(ENGINE_MODULE);
    const unloaded = new LocalAsrEngine({binding: unavailable.binding, resolveModelDirectory: () => 'C:/models/paraformer'});
    await assert.rejects(unloaded.load(PARA), (error) => error.message === '本地语音识别组件不可用');

    const start = await createReadyEngine(createRecognizerHarness({failStart: true}));
    await assert.rejects(start.start(16000), (error) => error.message === '本地语音识别失败');

    const decodeHarness = createRecognizerHarness({failDecode: true, results: ['unused']});
    const decode = await createReadyEngine(decodeHarness);
    const decodeEvents = []; decode.onResult((event) => decodeEvents.push(event));
    await decode.start(16000); decode.acceptPcm(new Int16Array([1]));
    assert.deepEqual(decodeEvents, [{type: 'error', text: '本地语音识别失败'}]);

    const stopHarness = createRecognizerHarness({failStop: true});
    const stop = await createReadyEngine(stopHarness);
    const stopEvents = []; stop.onResult((event) => stopEvents.push(event));
    await stop.start(16000); await stop.stop();
    assert.deepEqual(stopEvents, [{type: 'error', text: '本地语音识别失败'}]);
});

test('loading a new model keeps the old recognizer if construction fails', async () => {
    const harness = createRecognizerHarness();
    const engine = await createReadyEngine(harness);
    await engine.start(48000);
    engine.acceptPcm(new Int16Array([1]));
    const oldRecognizer = harness.recognizer;
    const oldStream = harness.stream;
    harness.binding.OnlineRecognizer = class { constructor() { throw new Error('native construction detail'); } };
    await assert.rejects(engine.load(ZIP), (error) => error.message === '本地语音识别组件不可用');
    assert.equal(engine.getStatus().state, 'recording');
    assert.equal(harness.recognizer, oldRecognizer);
    assert.equal(harness.stream, oldStream);
});
