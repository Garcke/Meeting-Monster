import path from 'node:path';
import {getAsrModel, type AsrModelDescriptor} from './asr-model-catalog';
import type {AsrModelId, AsrResultEvent, Unsubscribe} from '../shared/contracts';

const TARGET_SAMPLE_RATE = 16_000;
const STOP_SILENCE_SECONDS = 0.4;

export type LocalAsrState = 'idle' | 'ready' | 'recording' | 'error';
export interface LocalAsrStatus {state: LocalAsrState; message?: string}
export interface SherpaWaveform {sampleRate: number; samples: Float32Array}

export interface SherpaOnlineStream {
    acceptWaveform(waveform: SherpaWaveform): void;
}

export interface SherpaOnlineRecognizer {
    createStream(): SherpaOnlineStream;
    isReady(stream: SherpaOnlineStream): boolean;
    decode(stream: SherpaOnlineStream): void;
    getResult(stream: SherpaOnlineStream): {text: string};
    isEndpoint(stream: SherpaOnlineStream): boolean;
    reset(stream: SherpaOnlineStream): void;
    free?(): void;
    dispose?(): void;
}

export interface SherpaBinding {
    OnlineRecognizer: new (config: SherpaOnlineRecognizerConfig) => SherpaOnlineRecognizer;
    LinearResampler: new (inputSampleRate: number, outputSampleRate: number) => SherpaLinearResampler;
}
export interface SherpaLinearResampler {resample(samples: Float32Array): Float32Array; flush(samples: Float32Array): Float32Array}

export interface SherpaOnlineRecognizerConfig {
    featConfig: {sampleRate: number; featureDim: number};
    modelConfig: ReturnType<typeof createModelConfig>;
    decodingMethod: 'greedy_search';
    maxActivePaths: number;
    enableEndpoint: true;
    rule1MinTrailingSilence: number;
    rule2MinTrailingSilence: number;
    rule3MinUtteranceLength: number;
}

export interface LocalAsrEngineOptions {
    binding: SherpaBinding;
    resolveModelDirectory(id: AsrModelId): string;
}

function createModelConfig(model: AsrModelDescriptor, directory: string) {
    const tokens = path.join(directory, 'tokens.txt');
    const common = {tokens, numThreads: 2 as const, provider: 'cpu' as const, debug: 0 as const};
    if (model.kind === 'online-paraformer') {
        return {...common, paraformer: {
            encoder: path.join(directory, 'encoder.int8.onnx'),
            decoder: path.join(directory, 'decoder.int8.onnx'),
        }};
    }
    return {...common, transducer: {
        encoder: path.join(directory, 'encoder.int8.onnx'),
        decoder: path.join(directory, 'decoder.onnx'),
        joiner: path.join(directory, 'joiner.int8.onnx'),
    }};
}

function toFloat32(samples: Int16Array): Float32Array {
    const converted = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index]!;
        converted[index] = Math.max(-1, Math.min(1, sample < 0 ? sample / 32768 : sample / 32767));
    }
    return converted;
}

function release(recognizer: SherpaOnlineRecognizer | undefined): void {
    if (!recognizer) return;
    try {
        if (recognizer.free) {
            recognizer.free();
            return;
        }
    } catch {}
    try { recognizer.dispose?.(); } catch {}
}

export class LocalAsrEngine {
    private readonly binding: SherpaBinding;
    private readonly resolveModelDirectory: (id: AsrModelId) => string;
    private readonly resultListeners = new Set<(event: AsrResultEvent) => void>();
    private recognizer: SherpaOnlineRecognizer | undefined;
    private stream: SherpaOnlineStream | undefined;
    private resampler: SherpaLinearResampler | undefined;
    private lastPartial = '';
    private status: LocalAsrStatus = {state: 'idle'};

    constructor(options: LocalAsrEngineOptions) {
        this.binding = options.binding;
        this.resolveModelDirectory = options.resolveModelDirectory;
    }

    public getStatus(): LocalAsrStatus { return {...this.status}; }

    public onResult(listener: (event: AsrResultEvent) => void): Unsubscribe {
        this.resultListeners.add(listener);
        return () => this.resultListeners.delete(listener);
    }

    public async load(id: AsrModelId): Promise<LocalAsrStatus> {
        const model = getAsrModel(id);
        let next: SherpaOnlineRecognizer;
        try {
            const directory = this.resolveModelDirectory(id);
            next = new this.binding.OnlineRecognizer({
                featConfig: {sampleRate: TARGET_SAMPLE_RATE, featureDim: 80},
                modelConfig: createModelConfig(model, directory),
                decodingMethod: model.sherpa.decodingMethod,
                maxActivePaths: 4,
                enableEndpoint: model.sherpa.enableEndpointDetection,
                rule1MinTrailingSilence: model.endpoint.rule1MinTrailingSilence,
                rule2MinTrailingSilence: model.endpoint.rule2MinTrailingSilence,
                rule3MinUtteranceLength: model.endpoint.rule3MinUtteranceLength,
            });
        } catch {
            this.publishError('本地语音识别组件不可用', !this.recognizer);
            throw new Error('本地语音识别组件不可用');
        }
        if (this.stream) {
            const stopped = await this.stop();
            if (stopped.state === 'error') {
                release(next);
                throw new Error('本地语音识别失败');
            }
        }
        const previous = this.recognizer;
        this.recognizer = next;
        this.stream = undefined;
        this.resampler = undefined;
        this.lastPartial = '';
        this.status = {state: 'ready'};
        release(previous);
        return this.getStatus();
    }

    public async start(sampleRate: number): Promise<LocalAsrStatus> {
        try {
            if (!this.recognizer) throw new Error('recognizer is not loaded');
            this.stream = this.recognizer.createStream();
            this.resampler = sampleRate === TARGET_SAMPLE_RATE ? undefined : new this.binding.LinearResampler(sampleRate, TARGET_SAMPLE_RATE);
            this.lastPartial = '';
            this.status = {state: 'recording'};
            return this.getStatus();
        } catch {
            this.publishError('本地语音识别失败');
            throw new Error('本地语音识别失败');
        }
    }

    public acceptPcm(samples: Int16Array): void {
        if (!this.recognizer || !this.stream || this.status.state !== 'recording') return;
        try {
            const converted = toFloat32(samples);
            this.stream.acceptWaveform({sampleRate: TARGET_SAMPLE_RATE, samples: this.resampler ? this.resampler.resample(converted) : converted});
            this.decode(true);
            if (this.recognizer.isEndpoint(this.stream)) this.finishEndpoint();
        } catch {
            this.publishError('本地语音识别失败');
        }
    }

    public async stop(): Promise<LocalAsrStatus> {
        if (!this.stream || !this.recognizer) {
            this.status = {state: 'idle'};
            return this.getStatus();
        }
        try {
            if (this.resampler) this.stream.acceptWaveform({sampleRate: TARGET_SAMPLE_RATE, samples: this.resampler.flush(new Float32Array(0))});
            this.stream.acceptWaveform({sampleRate: TARGET_SAMPLE_RATE, samples: new Float32Array(TARGET_SAMPLE_RATE * STOP_SILENCE_SECONDS)});
            this.decode(false);
            this.emitFinal(this.lastPartial);
            this.lastPartial = '';
            this.stream = undefined;
            this.resampler = undefined;
            this.status = {state: 'idle'};
            return this.getStatus();
        } catch {
            this.stream = undefined;
            this.resampler = undefined;
            this.publishError('本地语音识别失败');
            return this.getStatus();
        }
    }

    public dispose(): void {
        if (this.stream) void this.stop();
        release(this.recognizer);
        this.recognizer = undefined;
        this.resampler = undefined;
        this.lastPartial = '';
        this.status = {state: 'idle'};
    }

    private decode(emitPartials: boolean): void {
        if (!this.recognizer || !this.stream) return;
        while (this.recognizer.isReady(this.stream)) {
            this.recognizer.decode(this.stream);
            const text = this.recognizer.getResult(this.stream).text;
            if (!text || text === this.lastPartial) continue;
            this.lastPartial = text;
            if (emitPartials) this.emit({type: 'partial', text});
        }
    }

    private finishEndpoint(): void {
        if (!this.stream) return;
        this.emitFinal(this.lastPartial);
        this.recognizer?.reset(this.stream);
        this.lastPartial = '';
    }

    private emitFinal(text: string): void { if (text) this.emit({type: 'final', text}); }
    private publishError(message: string, changeStatus = true): void {
        if (changeStatus) this.status = {state: 'error', message};
        this.emit({type: 'error', text: message});
    }
    private emit(event: AsrResultEvent): void { for (const listener of this.resultListeners) listener(event); }
}
