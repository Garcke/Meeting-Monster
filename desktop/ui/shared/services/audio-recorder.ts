import type {AudioInputMode} from './audio-input-mode';

export interface AudioRecorderOptions {
    inputMode: AudioInputMode;
    onPcm: (chunk: Int16Array) => void;
    workletUrl?: string;
    stopTimeoutMs?: number;
    onInputEnded?: (error: Error) => void;
}

export type RecordingPhase = 'idle' | 'connecting' | 'recording' | 'stopping';

export function canStartRecording(asrReady: boolean, phase: RecordingPhase): boolean {
    return asrReady && phase === 'idle';
}

export function canStopRecording(phase: RecordingPhase): boolean {
    return phase === 'recording';
}

export function createAudioInputPlan(inputMode: AudioInputMode): {needsSystem: boolean; needsMicrophone: boolean} {
    return {
        needsSystem: inputMode === 'system' || inputMode === 'mixed',
        needsMicrophone: inputMode === 'microphone' || inputMode === 'mixed',
    };
}

type AudioContextLike = AudioContext & {
    audioWorklet: AudioWorklet;
};

type RecorderInput = {
    stream: MediaStream;
    source: MediaStreamAudioSourceNode | null;
};

export class PcmAudioRecorder {
    private readonly options: Required<Pick<AudioRecorderOptions, 'workletUrl' | 'stopTimeoutMs'>>
        & Pick<AudioRecorderOptions, 'inputMode' | 'onPcm' | 'onInputEnded'>;
    private context: AudioContextLike | null = null;
    private inputs: RecorderInput[] = [];
    private processor: AudioWorkletNode | null = null;
    private silentGain: GainNode | null = null;
    private stopPromise: Promise<void> | null = null;
    private stopResolver: (() => void) | null = null;
    private stopTimer: number | null = null;

    public constructor(options: AudioRecorderOptions) {
        this.options = {
            inputMode: options.inputMode,
            onPcm: options.onPcm,
            onInputEnded: options.onInputEnded,
            workletUrl: options.workletUrl ?? 'recorder_worklet.js',
            stopTimeoutMs: options.stopTimeoutMs ?? 1000,
        };
    }

    public get isPrepared(): boolean { return this.context !== null && this.processor !== null; }

    public async prepare(): Promise<number> {
        if (this.context) throw new Error('录音器已经准备完成');
        try {
            const AudioContextCtor = (window.AudioContext
                ?? (window as Window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext);
            if (!AudioContextCtor) throw new Error('当前环境不支持 AudioContext');
            const context = new AudioContextCtor({sampleRate: 16000}) as AudioContextLike;
            this.context = context;

            const plan = createAudioInputPlan(this.options.inputMode);
            if (plan.needsSystem) {
                const stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
                stream.getVideoTracks().forEach((track) => track.stop());
                if (stream.getAudioTracks().length === 0) {
                    this.stopTracks(stream);
                    throw new Error('未检测到系统音频');
                }
                this.retainInput(stream, '系统音频');
            }
            if (plan.needsMicrophone) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {channelCount: 1, noiseSuppression: true, autoGainControl: true},
                });
                this.retainInput(stream, '麦克风');
            }

            await context.resume();
            await context.audioWorklet.addModule(this.options.workletUrl);
            this.processor = new AudioWorkletNode(context, 'pcm-processor');
            this.processor.port.onmessage = (event: MessageEvent) => {
                if (event.data instanceof Int16Array) {
                    try { this.options.onPcm(event.data); } catch { /* main process may have closed the port */ }
                } else if (event.data?.event === 'stopped') {
                    this.resolveStop();
                }
            };
            this.silentGain = context.createGain();
            this.silentGain.gain.value = 0;
            this.processor.connect(this.silentGain);
            this.silentGain.connect(context.destination);
            return context.sampleRate;
        } catch (error) {
            await this.cleanup();
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    public start(): void {
        if (!this.processor || this.inputs.length === 0) throw new Error('录音器尚未准备');
        this.inputs.forEach(({source}) => source?.connect(this.processor!));
    }

    public async stop(): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        this.stopPromise = this.stopAndCleanup();
        try { await this.stopPromise; } finally { this.stopPromise = null; }
    }

    private retainInput(stream: MediaStream, label: '系统音频' | '麦克风'): void {
        const input: RecorderInput = {stream, source: null};
        this.inputs.push(input);
        stream.getAudioTracks().forEach((track) => {
            track.onended = () => {
                try { this.options.onInputEnded?.(new Error(`${label}已结束`)); } catch { /* input-end reporting must not break cleanup */ }
            };
        });
        input.source = this.context!.createMediaStreamSource(stream);
    }

    private async stopAndCleanup(): Promise<void> {
        if (this.processor) {
            await new Promise<void>((resolve) => {
                this.stopResolver = resolve;
                this.stopTimer = window.setTimeout(() => this.resolveStop(), this.options.stopTimeoutMs);
                try { this.processor?.port.postMessage({event: 'stop'}); } catch { this.resolveStop(); }
            });
        }
        await this.cleanup();
    }

    private resolveStop(): void {
        if (this.stopTimer !== null) {
            window.clearTimeout(this.stopTimer);
            this.stopTimer = null;
        }
        const resolve = this.stopResolver;
        this.stopResolver = null;
        resolve?.();
    }

    private stopTracks(stream: MediaStream): void {
        stream.getTracks().forEach((track) => {
            track.onended = null;
            track.stop();
        });
    }

    private async cleanup(): Promise<void> {
        this.resolveStop();
        this.inputs.forEach(({source}) => source?.disconnect());
        this.processor?.disconnect();
        this.silentGain?.disconnect();
        try { this.processor?.port.close(); } catch {}
        this.inputs.forEach(({stream}) => this.stopTracks(stream));
        this.inputs = [];
        this.processor = null;
        this.silentGain = null;
        const context = this.context;
        this.context = null;
        if (context && context.state !== 'closed') await context.close();
    }
}
