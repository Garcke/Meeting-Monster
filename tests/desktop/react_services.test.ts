import {afterEach, describe, expect, it, vi} from 'vitest';
import {describeAsrModel, formatAsrModelStatus, isAsrModelReady} from '../../desktop/ui/shared/services/asr-model-service';
import {canStartRecording, canStopRecording, createAudioInputPlan, PcmAudioRecorder} from '../../desktop/ui/shared/services/audio-recorder';
import {QuestionStore} from '../../desktop/ui/shared/services/question-store';
import {
    AUDIO_INPUT_MODE_STORAGE_KEY,
    getDefaultAudioInputMode,
    normalizeAudioInputMode,
    readAudioInputMode,
    writeAudioInputMode,
} from '../../desktop/ui/shared/services/audio-input-mode';
import {BUILT_IN_MODEL_PROFILES, buildModelSelection} from '../../desktop/ui/shared/services/model-settings-service';
import {stripAssistantThinking} from '../../desktop/ui/shared/services/assistant-markdown';

class FakeTrack {
    public onended: (() => void) | null = null;
    public stopped = false;
    public stopCalls = 0;

    public constructor(public readonly kind: 'audio' | 'video') {}

    public stop() { this.stopped = true; this.stopCalls += 1; }

    public end() { this.onended?.(); }
}

class FakeStream {
    public constructor(public readonly tracks: FakeTrack[]) {}

    public getTracks() { return this.tracks; }
    public getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
    public getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
}

class FakeSource {
    public connectedTo: unknown[] = [];
    public disconnected = false;

    public connect(target: unknown) { this.connectedTo.push(target); return target; }
    public disconnect() { this.disconnected = true; }
}

class FakeProcessor {
    public static instances: FakeProcessor[] = [];
    public readonly port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        close: vi.fn(),
        postMessage: vi.fn((message: {event: string}) => {
            if (message.event === 'stop') this.port.onmessage?.({data: {event: 'stopped'}} as MessageEvent);
        }),
    };
    public disconnected = false;

    public constructor(_context: unknown, _name: string) { FakeProcessor.instances.push(this); }

    public connect(target: unknown) { return target; }
    public disconnect() { this.disconnected = true; }
}

class FakeAudioContext {
    public static instances: FakeAudioContext[] = [];
    public readonly sampleRate = 16000;
    public state: 'running' | 'closed' = 'running';
    public readonly audioWorklet = {addModule: vi.fn().mockResolvedValue(undefined)};
    public readonly destination = {};
    public readonly sources: FakeSource[] = [];
    public readonly gain = {gain: {value: 1}, connect: vi.fn(), disconnect: vi.fn()};
    public resume = vi.fn().mockResolvedValue(undefined);
    public close = vi.fn(async () => { this.state = 'closed'; });

    public constructor(_options: AudioContextOptions) { FakeAudioContext.instances.push(this); }

    public createMediaStreamSource(_stream: MediaStream) {
        const source = new FakeSource();
        this.sources.push(source);
        return source;
    }

    public createGain() { return this.gain; }
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalAudioWorkletNode = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');

function installAudioFakes({
    displayStream = new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]),
    microphoneStream = new FakeStream([new FakeTrack('audio')]),
    displayError,
    microphoneError,
}: {
    displayStream?: FakeStream;
    microphoneStream?: FakeStream;
    displayError?: Error;
    microphoneError?: Error;
} = {}) {
    FakeAudioContext.instances = [];
    FakeProcessor.instances = [];
    const getDisplayMedia = vi.fn(async () => {
        if (displayError) throw displayError;
        return displayStream as unknown as MediaStream;
    });
    const getUserMedia = vi.fn(async () => {
        if (microphoneError) throw microphoneError;
        return microphoneStream as unknown as MediaStream;
    });
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {mediaDevices: {getDisplayMedia, getUserMedia}}});
    Object.defineProperty(globalThis, 'window', {configurable: true, value: {AudioContext: FakeAudioContext, setTimeout, clearTimeout}});
    Object.defineProperty(globalThis, 'AudioWorkletNode', {configurable: true, value: FakeProcessor});
    return {displayStream, microphoneStream, getDisplayMedia, getUserMedia};
}

afterEach(() => {
    for (const [name, descriptor] of [
        ['navigator', originalNavigator],
        ['window', originalWindow],
        ['AudioWorkletNode', originalAudioWorkletNode],
    ] as const) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
    }
    vi.restoreAllMocks();
});

it('exposes exactly the two fixed protocol profiles', () => {
    expect(BUILT_IN_MODEL_PROFILES.map(({id, label, protocol}) => ({id, label, protocol}))).toEqual([
        {id: 'generic_openai', label: 'OpenAI Compatible', protocol: 'openai'},
        {id: 'generic_anthropic', label: 'Anthropic Compatible', protocol: 'anthropic'},
    ]);
});

it('builds a complete typed model selection from form values', () => {
    const profile = BUILT_IN_MODEL_PROFILES[0];
    expect(buildModelSelection(profile, {
        baseUrl: ' https://provider.example/v1/ ', model: ' demo-model ', apiKey: ' secret ',
        maxTokens: '2048', temperature: '0.4',
    })).toEqual({
        profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://provider.example/v1',
        model: 'demo-model', api_key: 'secret', max_tokens: 2048, temperature: 0.4,
    });
});

it('rejects invalid numeric model settings instead of silently omitting them', () => {
    const profile = BUILT_IN_MODEL_PROFILES[0];
    expect(() => buildModelSelection(profile, {
        baseUrl: 'https://provider.example/v1',
        model: 'demo-model',
        apiKey: '',
        maxTokens: 'not-a-number',
        temperature: '0.4',
    })).toThrow(/max tokens/i);
    expect(() => buildModelSelection(profile, {
        baseUrl: 'https://provider.example/v1',
        model: 'demo-model',
        apiKey: '',
        maxTokens: '2048',
        temperature: 'not-a-number',
    })).toThrow(/temperature/i);
});

it('removes complete provider thinking blocks while preserving Markdown answer text', () => {
    expect(stripAssistantThinking(
        '<think>private reasoning</think>\n\n**Visible answer**',
    )).toBe('**Visible answer**');
});

it('hides an incomplete trailing thinking block during streaming', () => {
    expect(stripAssistantThinking('<think>private reasoning still streaming')).toBe('');
    expect(stripAssistantThinking('<think>private</think>\nVisible')).toBe('Visible');
});

it('removes standalone closing thinking tags without changing surrounding Markdown', () => {
    expect(stripAssistantThinking('</think>\n- item')).toBe('- item');
    expect(stripAssistantThinking('Plain **text**')).toBe('Plain **text**');
});

it('rejects invalid Base URL, empty Model ID, and mismatched protocol in the renderer', () => {
    const profile = BUILT_IN_MODEL_PROFILES[0];
    const baseValues = {model: 'demo-model', apiKey: '', maxTokens: '2048', temperature: '0.3'};
    expect(() => buildModelSelection(profile, {...baseValues, baseUrl: 'file:///not-http'})).toThrow(/base url/i);
    expect(() => buildModelSelection(profile, {...baseValues, baseUrl: 'https://provider.example/v1?secret=1'})).toThrow(/base url/i);
    expect(() => buildModelSelection(profile, {...baseValues, baseUrl: 'http://provider.example/v1'})).toThrow(/https|local/i);
    expect(() => buildModelSelection(profile, {...baseValues, baseUrl: 'http://127.0.0.1:8000/v1'})).not.toThrow();
    expect(() => buildModelSelection(profile, {...baseValues, baseUrl: 'https://provider.example/v1', model: '  '})).toThrow(/model/i);
    expect(() => buildModelSelection(
        {...profile, protocol: 'anthropic'} as typeof profile,
        {...baseValues, baseUrl: 'https://provider.example/v1'},
    )).toThrow(/protocol/i);
});

describe('React session services', () => {
    it.each([
        ['system', {needsSystem: true, needsMicrophone: false}],
        ['microphone', {needsSystem: false, needsMicrophone: true}],
        ['mixed', {needsSystem: true, needsMicrophone: true}],
    ] as const)('creates the expected %s input plan', (inputMode, expected) => {
        expect(createAudioInputPlan(inputMode)).toEqual(expected);
    });

    it('captures system audio without microphone permission and stops display video immediately', async () => {
        const fakes = installAudioFakes();
        const recorder = new PcmAudioRecorder({inputMode: 'system', onPcm: vi.fn()});

        await recorder.prepare();
        recorder.start();

        expect(fakes.getDisplayMedia).toHaveBeenCalledWith({video: true, audio: true});
        expect(fakes.getUserMedia).not.toHaveBeenCalled();
        expect(fakes.displayStream.getVideoTracks()[0].stopped).toBe(true);
        expect(FakeAudioContext.instances[0].sources).toHaveLength(1);
        expect(FakeAudioContext.instances[0].sources[0].connectedTo).toEqual([FakeProcessor.instances[0]]);

        await recorder.stop();
        expect(fakes.displayStream.getAudioTracks()[0].stopped).toBe(true);
    });

    it('rejects a display stream without system audio after stopping every track', async () => {
        const displayStream = new FakeStream([new FakeTrack('video')]);
        installAudioFakes({displayStream});
        const recorder = new PcmAudioRecorder({inputMode: 'system', onPcm: vi.fn()});

        await expect(recorder.prepare()).rejects.toThrow('系统音频');

        expect(displayStream.getTracks().every((track) => track.stopped)).toBe(true);
        expect(recorder.isPrepared).toBe(false);
    });

    it('captures microphone audio without display permission', async () => {
        const fakes = installAudioFakes();
        const recorder = new PcmAudioRecorder({inputMode: 'microphone', onPcm: vi.fn()});

        await recorder.prepare();

        expect(fakes.getDisplayMedia).not.toHaveBeenCalled();
        expect(fakes.getUserMedia).toHaveBeenCalledWith({
            audio: {channelCount: 1, noiseSuppression: true, autoGainControl: true},
        });
        await recorder.stop();
    });

    it('connects both sources for mixed input and stops every audio track once', async () => {
        const fakes = installAudioFakes();
        const recorder = new PcmAudioRecorder({inputMode: 'mixed', onPcm: vi.fn()});

        await recorder.prepare();
        recorder.start();
        const firstStop = recorder.stop();
        const secondStop = recorder.stop();
        await Promise.all([firstStop, secondStop]);

        expect(fakes.getDisplayMedia).toHaveBeenCalledOnce();
        expect(fakes.getUserMedia).toHaveBeenCalledOnce();
        expect(fakes.getDisplayMedia.mock.invocationCallOrder[0]).toBeLessThan(fakes.getUserMedia.mock.invocationCallOrder[0]);
        expect(FakeAudioContext.instances[0].sources).toHaveLength(2);
        expect(FakeAudioContext.instances[0].sources.every((source) => source.connectedTo[0] === FakeProcessor.instances[0])).toBe(true);
        expect(fakes.displayStream.getAudioTracks()[0].stopped).toBe(true);
        expect(fakes.microphoneStream.getAudioTracks()[0].stopped).toBe(true);
        expect(fakes.displayStream.getAudioTracks()[0].stopCalls).toBe(1);
        expect(fakes.microphoneStream.getAudioTracks()[0].stopCalls).toBe(1);
    });

    it('reports the source when an input track ends', async () => {
        const fakes = installAudioFakes();
        const onInputEnded = vi.fn();
        const recorder = new PcmAudioRecorder({inputMode: 'mixed', onPcm: vi.fn(), onInputEnded});

        await recorder.prepare();
        fakes.displayStream.getAudioTracks()[0].end();
        fakes.microphoneStream.getAudioTracks()[0].end();

        expect(onInputEnded).toHaveBeenCalledTimes(2);
        expect(onInputEnded.mock.calls[0][0].message).toContain('系统音频已结束');
        expect(onInputEnded.mock.calls[1][0].message).toContain('麦克风已结束');
        await recorder.stop();
    });

    it('cleans up acquired display media when microphone capture fails', async () => {
        const fakes = installAudioFakes({microphoneError: new Error('microphone denied')});
        const recorder = new PcmAudioRecorder({inputMode: 'mixed', onPcm: vi.fn()});

        await expect(recorder.prepare()).rejects.toThrow('microphone denied');

        expect(fakes.displayStream.getTracks().every((track) => track.stopped)).toBe(true);
        expect(recorder.isPrepared).toBe(false);
    });

    it('cleans up the context when display capture fails', async () => {
        const fakes = installAudioFakes({displayError: new Error('display denied')});
        const recorder = new PcmAudioRecorder({inputMode: 'system', onPcm: vi.fn()});

        await expect(recorder.prepare()).rejects.toThrow('display denied');
        expect(recorder.isPrepared).toBe(false);
    });

    it('keeps question answer state isolated and clone-safe', () => {
        const store = new QuestionStore();
        const question = store.addQuestion('What should I say?', 'manual');
        expect(question?.id).toBe('question-1');
        store.setAnswerStatus('question-1', 'loading');
        store.appendAnswer('question-1', 'A useful answer');
        const read = store.getSelected();
        expect(read?.answer).toBe('A useful answer');
        if (read) read.answer = 'mutated outside';
        expect(store.getSelected()?.answer).toBe('A useful answer');
        store.clear();
        expect(store.getQuestions()).toEqual([]);
    });

    it('auto-selects ASR fragments and toggles a multi-selection in transcript order', () => {
        const store = new QuestionStore();
        const first = store.addQuestion('第一段', 'asr');
        const second = store.addQuestion('第二段', 'asr');

        expect(store.getSelectedIds()).toEqual([first?.id, second?.id]);
        expect(store.getSelectedQuestions().map((question) => question.text)).toEqual(['第一段', '第二段']);
        expect(store.toggleQuestion(first?.id ?? '')).toBe(false);
        expect(store.getSelectedQuestions().map((question) => question.text)).toEqual(['第二段']);
        expect(store.toggleQuestion(first?.id ?? '')).toBe(true);
        expect(store.getSelectedQuestions().map((question) => question.text)).toEqual(['第一段', '第二段']);
    });

    it('blocks recording re-entry while the recorder is connecting or stopping', () => {
        expect(canStartRecording(true, 'idle')).toBe(true);
        expect(canStartRecording(true, 'connecting')).toBe(false);
        expect(canStartRecording(true, 'recording')).toBe(false);
        expect(canStartRecording(true, 'stopping')).toBe(false);
        expect(canStartRecording(false, 'idle')).toBe(false);
        expect(canStopRecording('recording')).toBe(true);
        expect(canStopRecording('connecting')).toBe(false);
        expect(canStopRecording('stopping')).toBe(false);
    });

    it('gates recording on the current installed ASR model and exposes hotword capability', () => {
        const snapshot = {
            currentModelId: 'streaming-paraformer-bilingual-zh-en' as const,
            models: [{
                id: 'streaming-paraformer-bilingual-zh-en' as const,
                label: 'Paraformer', languages: ['zh', 'en'], description: 'local', estimatedBytes: 226,
                supportsHotwords: false, installedState: 'installed' as const, isCurrent: true,
                downloadedBytes: 226, totalBytes: 226,
            }],
        };
        expect(isAsrModelReady(snapshot, snapshot.currentModelId)).toBe(true);
        expect(formatAsrModelStatus(snapshot, snapshot.currentModelId, null)).toBe('已安装');
        expect(describeAsrModel(snapshot.models[0])).toContain('不支持热词');
    });
    it('defaults to system audio input on Windows and microphone elsewhere', () => {
        expect(getDefaultAudioInputMode('win32')).toBe('system');
        expect(getDefaultAudioInputMode('darwin')).toBe('microphone');
    });

    it('normalizes audio input modes at the platform boundary', () => {
        expect(normalizeAudioInputMode('system', 'win32')).toBe('system');
        expect(normalizeAudioInputMode('microphone', 'win32')).toBe('microphone');
        expect(normalizeAudioInputMode('mixed', 'win32')).toBe('mixed');
        expect(normalizeAudioInputMode('system', 'darwin')).toBe('microphone');
        expect(normalizeAudioInputMode('invalid', 'win32')).toBe('system');
    });

    it('normalizes invalid persisted audio input modes by platform', () => {
        const values = new Map<string, string>();
        values.set(AUDIO_INPUT_MODE_STORAGE_KEY, 'invalid');
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        };

        expect(readAudioInputMode(storage, 'win32')).toBe('system');
        expect(readAudioInputMode(storage, 'darwin')).toBe('microphone');
    });

    it('reads and writes normalized audio input modes through a storage adapter', () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        };

        writeAudioInputMode(storage, 'mixed', 'win32');
        expect(values.get(AUDIO_INPUT_MODE_STORAGE_KEY)).toBe('mixed');
        expect(readAudioInputMode(storage, 'win32')).toBe('mixed');

        writeAudioInputMode(storage, 'mixed', 'darwin');
        expect(values.get(AUDIO_INPUT_MODE_STORAGE_KEY)).toBe('microphone');
    });
});
