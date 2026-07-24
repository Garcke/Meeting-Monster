declare module 'sherpa\x2donnx\x2dnode' {
    export interface OnlineRecognizerConfig {
        featConfig: {sampleRate: number; featureDim: number};
        modelConfig: Record<string, unknown>;
        decodingMethod: string;
        maxActivePaths: number;
        enableEndpoint: boolean;
        rule1MinTrailingSilence: number;
        rule2MinTrailingSilence: number;
        rule3MinUtteranceLength: number;
    }
    export interface OnlineStream {
        acceptWaveform(waveform: {sampleRate: number; samples: Float32Array}): void;
    }
    export class OnlineRecognizer {
        constructor(config: OnlineRecognizerConfig);
        createStream(): OnlineStream;
        isReady(stream: OnlineStream): boolean;
        decode(stream: OnlineStream): void;
        getResult(stream: OnlineStream): {text: string};
        isEndpoint(stream: OnlineStream): boolean;
        reset(stream: OnlineStream): void;
        free?(): void;
        dispose?(): void;
    }
    export class LinearResampler {
        constructor(inputSampleRate: number, outputSampleRate: number);
        resample(samples: Float32Array): Float32Array;
        flush(samples: Float32Array): Float32Array;
    }
}

declare module 'unbzip2-stream' {
    import {Transform} from 'node:stream';
    function unbzip2(): Transform;
    export = unbzip2;
}

declare module 'tar-stream' {
    import {Writable} from 'node:stream';
    export interface Headers { name: string; type?: string; size?: number; }
    export interface Extract extends Writable {
        on(event: 'entry', listener: (header: Headers, stream: NodeJS.ReadableStream, next: (error?: Error) => void) => void): this;
        on(event: 'finish', listener: () => void): this;
    }
    export function extract(): Extract;
}
