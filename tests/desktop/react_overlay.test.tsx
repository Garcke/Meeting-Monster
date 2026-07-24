// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {CapsuleApp} from '../../desktop/ui/capsule/main';
import {SettingsView} from '../../desktop/ui/panel/SettingsView';
import {WorkspaceView} from '../../desktop/ui/panel/WorkspaceView';
import {OverlayApp} from '../../desktop/ui/overlay/main';
import type {AsrModelSnapshot, ChatStreamEvent, MeetingMonsterApi, OverlaySnapshot, PrivacyStatus} from '../../desktop/src/shared/contracts';
import {AUDIO_INPUT_MODE_EVENT, AUDIO_INPUT_MODE_STORAGE_KEY} from '../../desktop/ui/shared/services/audio-input-mode';

const snapshot: OverlaySnapshot = {target: 'closed', phase: 'hidden', revision: 0};
const privacy: PrivacyStatus = {captureProtection: 'protected', captureProtectionEnabled: true, platform: 'win32', windowCount: 1};
const asrModels: AsrModelSnapshot = {
    currentModelId: 'streaming-paraformer-bilingual-zh-en',
    models: [
        {id: 'streaming-paraformer-bilingual-zh-en', label: 'Streaming Paraformer (Chinese + English)', languages: ['zh', 'en'], description: 'Paraformer', estimatedBytes: 226_000_000, supportsHotwords: false, installedState: 'installed', isCurrent: true, downloadedBytes: 226_000_000, totalBytes: 226_000_000},
        {id: 'streaming-zipformer-zh-int8-2025-06-30', label: 'Streaming Zipformer (Chinese)', languages: ['zh'], description: 'Zipformer', estimatedBytes: 180_000_000, supportsHotwords: false, installedState: 'not-downloaded', isCurrent: false, downloadedBytes: 0, totalBytes: 180_000_000},
    ],
};

function fakeApi(privacyStatus: PrivacyStatus = privacy) {
    const intents: Array<{type: string}> = [];
    const asrListeners = new Set<(event: {type: string; text: string}) => void>();
    const chatListeners = new Set<(event: ChatStreamEvent) => void>();
    const chatSends: Array<{requestId: string; prompt: string}> = [];
    const api = {
        overlay: {
            intent: vi.fn(async ({type}: {type: 'toggle-workspace' | 'toggle-settings'}) => {
                intents.push({type});
                return {target: type === 'toggle-settings' ? 'settings' : 'workspace', phase: 'opening', revision: intents.length} as OverlaySnapshot;
            }),
            getSnapshot: vi.fn(async () => snapshot),
            onSnapshot: vi.fn(() => () => {}),
            rendererReady: vi.fn(async (revision: number) => ({...snapshot, revision})),
            panelReady: vi.fn(async (revision: number) => ({...snapshot, revision})),
            animationFinished: vi.fn(async (revision: number) => ({...snapshot, revision})),
            onWindowError: vi.fn(() => () => {}),
        },
        privacy: {
            getStatus: vi.fn(async () => privacyStatus),
            onStatus: vi.fn(() => () => {}),
            setCaptureProtection: vi.fn(async () => privacy),
        },
        asr: {
            getStatus: vi.fn(async () => ({state: 'idle' as const})),
            onStatus: vi.fn(() => () => {}),
            onResult: vi.fn((listener: (event: {type: string; text: string}) => void) => { asrListeners.add(listener); return () => asrListeners.delete(listener); }),
            start: vi.fn(async () => undefined),
            stop: vi.fn(async () => undefined),
            writePcm: vi.fn(),
        },
        asrModels: {
            list: vi.fn(async () => asrModels),
            onStatus: vi.fn(() => () => {}),
            select: vi.fn(async () => asrModels), download: vi.fn(async () => asrModels),
            cancel: vi.fn(async () => ({cancelled: true})), delete: vi.fn(async () => asrModels),
        },
        models: {
            list: vi.fn(async () => ({active_profile: 'generic_openai', profiles: []})),
            getSaved: vi.fn(async () => null), save: vi.fn(), test: vi.fn(),
        },
        chat: {
            onEvent: vi.fn((listener: (event: ChatStreamEvent) => void) => { chatListeners.add(listener); return () => chatListeners.delete(listener); }),
            send: vi.fn(async (requestId: string, prompt: string) => { chatSends.push({requestId, prompt}); }),
            cancel: vi.fn(async () => undefined),
        },
        window: {hide: vi.fn(), show: vi.fn(), getState: vi.fn(), setExpanded: vi.fn(), toggleExpanded: vi.fn(), onState: vi.fn()},
    } as unknown as MeetingMonsterApi;
    return {
        api,
        intents,
        chatSends,
        emitAsrResult: (event: {type: string; text: string}) => { for (const listener of asrListeners) listener(event); },
        emitChatEvent: (event: ChatStreamEvent) => { for (const listener of chatListeners) listener(event); },
    };
}

class FakeWorkspaceTrack {
    public onended: (() => void) | null = null;
    public stopCalls = 0;

    public constructor(public readonly kind: 'audio' | 'video') {}

    public stop() { this.stopCalls += 1; }
    public end() { this.onended?.(); }
}

class FakeWorkspaceStream {
    public constructor(public readonly tracks: FakeWorkspaceTrack[]) {}

    public getTracks() { return this.tracks; }
    public getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
    public getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
}

class FakeWorkspaceSource {
    public connect = vi.fn();
    public disconnect = vi.fn();
}

class FakeWorkspaceProcessor {
    public readonly port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        close: vi.fn(),
        postMessage: vi.fn((message: {event: string}) => {
            if (message.event === 'stop') this.port.onmessage?.({data: {event: 'stopped'}} as MessageEvent);
        }),
    };

    public connect = vi.fn();
    public disconnect = vi.fn();
}

class FakeWorkspaceAudioContext {
    public readonly sampleRate = 16000;
    public state: 'running' | 'closed' = 'running';
    public readonly audioWorklet = {addModule: vi.fn().mockResolvedValue(undefined)};
    public readonly destination = {};
    public readonly gain = {gain: {value: 1}, connect: vi.fn(), disconnect: vi.fn()};
    public resume = vi.fn().mockResolvedValue(undefined);
    public close = vi.fn(async () => { this.state = 'closed'; });

    public createMediaStreamSource(_stream: MediaStream) { return new FakeWorkspaceSource(); }
    public createGain() { return this.gain; }
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const originalAudioContext = Object.getOwnPropertyDescriptor(window, 'AudioContext');
const originalAudioWorkletNode = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');

function installWorkspaceAudioFakes({
    displayError,
    microphoneError,
}: {
    displayError?: Error;
    microphoneError?: Error;
} = {}) {
    const displayStream = new FakeWorkspaceStream([
        new FakeWorkspaceTrack('audio'),
        new FakeWorkspaceTrack('video'),
    ]);
    const microphoneStream = new FakeWorkspaceStream([new FakeWorkspaceTrack('audio')]);
    const getDisplayMedia = vi.fn(async () => {
        if (displayError) throw displayError;
        return displayStream as unknown as MediaStream;
    });
    const getUserMedia = vi.fn(async () => {
        if (microphoneError) throw microphoneError;
        return microphoneStream as unknown as MediaStream;
    });

    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {getDisplayMedia, getUserMedia},
    });
    Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        value: FakeWorkspaceAudioContext,
    });
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        value: FakeWorkspaceProcessor,
    });

    return {displayStream, microphoneStream, getDisplayMedia, getUserMedia};
}

function restoreProperty(target: object, name: PropertyKey, descriptor?: PropertyDescriptor) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
}

function audioPermissionError(rawMessage: string) {
    const error = new Error(rawMessage);
    error.name = 'NotAllowedError';
    error.stack = `RAW STACK: ${rawMessage}`;
    return error;
}

function workspaceRecordButtons(container: HTMLElement) {
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.record-action'));
    return {start: buttons[0]!, stop: buttons[1]!};
}

afterEach(() => {
    cleanup();
    restoreProperty(navigator, 'mediaDevices', originalMediaDevices);
    restoreProperty(window, 'AudioContext', originalAudioContext);
    restoreProperty(globalThis, 'AudioWorkletNode', originalAudioWorkletNode);
    vi.restoreAllMocks();
    window.localStorage.clear();
});

test('capsule keeps settings and workspace as independent intents, including rapid clicks', async () => {
    const {api, intents} = fakeApi();
    window.meetingMonster = api;
    render(<CapsuleApp />);
    await waitFor(() => expect(screen.getByRole('button', {name: '设置'})).toBeTruthy());
    fireEvent.click(screen.getByRole('button', {name: '设置'}));
    fireEvent.click(screen.getByRole('button', {name: '设置'}));
    expect(intents.map((item) => item.type)).toEqual(['toggle-settings', 'toggle-settings']);
    expect(intents.some((item) => item.type === 'toggle-workspace')).toBe(false);
});

test('capsule exit control quits the app instead of hiding it', async () => {
    const {api} = fakeApi();
    const quit = vi.fn(async () => undefined);
    (api.window as typeof api.window & {quit: typeof quit}).quit = quit;
    api.window.hide = vi.fn(async () => ({mode: 'capsule', visible: false}));
    window.meetingMonster = api;
    render(<CapsuleApp />);

    const exit = await screen.findByRole('button', {name: '退出应用'});
    fireEvent.click(exit);

    expect(quit).toHaveBeenCalledOnce();
    expect(api.window.hide).not.toHaveBeenCalled();
});

test('settings renders compact model dropdowns and does not own overlay navigation', async () => {
    const {api} = fakeApi();
    window.meetingMonster = api;
    render(<SettingsView active />);
    await waitFor(() => expect(screen.getByLabelText('API Key')).toBeTruthy());
    expect(screen.getByLabelText('模型')).toBeTruthy();
    expect(screen.getByLabelText('识别模型')).toBeTruthy();
    expect(api.overlay.intent).not.toHaveBeenCalled();
});

test('settings exposes only the two compatible protocol options and keeps independent form snapshots', async () => {
    const {api} = fakeApi();
    api.models.getSaved = vi.fn(async () => ({
        active_profile: 'generic_openai',
        connections: {
            generic_openai: {
                profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://openai.example/v1',
                model: 'openai-model', has_api_key: true, max_tokens: 2048, temperature: 0.2,
            },
        },
    }));
    window.meetingMonster = api;
    render(<SettingsView active />);

    const protocol = await screen.findByLabelText('API 协议') as HTMLSelectElement;
    expect(Array.from(protocol.options).map((option) => option.textContent)).toEqual([
        'OpenAI Compatible', 'Anthropic Compatible',
    ]);
    expect(screen.queryByText(/MiniMax|Moonshot|GLM|OpenRouter|Vercel|OpenCode/)).toBeNull();
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://openai.example/v1');
    expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('openai-model');

    fireEvent.change(protocol, {target: {value: 'generic_anthropic'}});
    fireEvent.change(screen.getByLabelText('Base URL'), {target: {value: 'https://anthropic.example'}});
    fireEvent.change(screen.getByLabelText('Model ID'), {target: {value: 'anthropic-model'}});
    fireEvent.change(protocol, {target: {value: 'generic_openai'}});
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://openai.example/v1');
    expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('openai-model');
});

test('settings blocks save before IPC when Base URL or Model ID is invalid', async () => {
    const {api} = fakeApi();
    api.models.getSaved = vi.fn(async () => ({active_profile: 'generic_openai', connections: {}}));
    api.models.save = vi.fn(async () => ({active_profile: 'generic_openai', connections: {}}));
    window.meetingMonster = api;
    render(<SettingsView active />);
    await screen.findByLabelText('API 协议');
    fireEvent.change(screen.getByLabelText('Base URL'), {target: {value: 'file:///not-http'}});
    fireEvent.click(screen.getByRole('button', {name: '保存连接'}));
    expect(api.models.save).not.toHaveBeenCalled();
});

test('settings renders the Windows audio-source selector with system audio selected by default', async () => {
    const {api} = fakeApi();
    window.meetingMonster = api;
    render(<SettingsView active />);

    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;

    expect(select.id).toBe('asrAudioInputSelect');
    expect(select.value).toBe('system');
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['系统音频', '麦克风', '系统音频＋麦克风']);
});

test('settings persists a mixed Windows audio source and broadcasts the change', async () => {
    const {api} = fakeApi();
    const onAudioInputModeChange = vi.fn();
    window.meetingMonster = api;
    window.addEventListener(AUDIO_INPUT_MODE_EVENT, onAudioInputModeChange);
    render(<SettingsView active />);

    const select = await screen.findByLabelText('音频来源');
    fireEvent.change(select, {target: {value: 'mixed'}});

    expect(window.localStorage.getItem(AUDIO_INPUT_MODE_STORAGE_KEY)).toBe('mixed');
    expect(onAudioInputModeChange).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUDIO_INPUT_MODE_EVENT, onAudioInputModeChange);
});

test('settings ignores audio-source changes while the privacy platform is still resolving', async () => {
    let resolvePrivacyStatus!: (status: PrivacyStatus) => void;
    const delayedPrivacyStatus = new Promise<PrivacyStatus>((resolve) => { resolvePrivacyStatus = resolve; });
    const {api} = fakeApi();
    const onAudioInputModeChange = vi.fn();
    api.privacy.getStatus = vi.fn(() => delayedPrivacyStatus);
    window.meetingMonster = api;
    window.addEventListener(AUDIO_INPUT_MODE_EVENT, onAudioInputModeChange);

    try {
        render(<SettingsView active />);
        const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;

        expect(select.disabled).toBe(true);
        fireEvent.change(select, {target: {value: 'mixed'}});
        expect(window.localStorage.getItem(AUDIO_INPUT_MODE_STORAGE_KEY)).toBeNull();
        expect(onAudioInputModeChange).not.toHaveBeenCalled();

        act(() => resolvePrivacyStatus({...privacy, platform: 'darwin'}));
        await waitFor(() => expect(select.value).toBe('microphone'));
    } finally {
        window.removeEventListener(AUDIO_INPUT_MODE_EVENT, onAudioInputModeChange);
    }
});

test('settings falls back to microphone when the privacy platform cannot be loaded', async () => {
    const {api} = fakeApi();
    api.privacy.getStatus = vi.fn(async () => { throw new Error('privacy status unavailable'); });
    window.meetingMonster = api;
    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    render(<SettingsView active />);

    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('microphone'));
    expect(select.options[0]?.disabled).toBe(true);
    expect(select.options[2]?.disabled).toBe(true);
    expect(screen.getByText('无法确定系统平台，当前使用麦克风。')).toBeTruthy();
});

test('settings normalizes macOS to microphone and disables unavailable audio sources', async () => {
    const {api} = fakeApi({...privacy, platform: 'darwin'});
    window.meetingMonster = api;
    render(<SettingsView active />);

    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('microphone'));
    expect(select.options[0]?.disabled).toBe(true);
    expect(select.options[2]?.disabled).toBe(true);
    expect(screen.getByText('系统音频当前仅支持 Windows；当前使用麦克风。')).toBeTruthy();
});

test('overlay keeps the prompt pill in the fixed panel header with a star', async () => {
    const {api} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<OverlayApp />);

    await waitFor(() => expect(container.querySelector('.panel-drag-handle')).toBeTruthy());
    const header = container.querySelector('.panel-drag-handle');
    const prompt = container.querySelector('.panel-prompt');
    const transcript = container.querySelector('.workspace-transcript');

    expect(prompt?.closest('.panel-drag-handle')).toBe(header);
    expect(prompt?.classList.contains('panel-prompt')).toBe(true);
    expect(prompt?.textContent).toContain('✦');
    expect(prompt?.textContent).toContain('What should I say?');
    expect(transcript?.querySelector('.panel-prompt')).toBeNull();
});

test('workspace automatically selects ASR fragments and sends the selected text together', async () => {
    const {api, chatSends, emitAsrResult} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    await waitFor(() => expect(container.querySelector('.workspace-transcript')).toBeTruthy());
    act(() => {
        emitAsrResult({type: 'final', text: '第一段问题'});
        emitAsrResult({type: 'final', text: '第二段补充'});
    });

    await waitFor(() => expect(container.querySelectorAll('.question-row')).toHaveLength(2));
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('.question-row'));
    expect(rows.map((row) => row.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
    await waitFor(() => expect(chatSends.length).toBe(2));
    expect(chatSends[1]?.prompt).toContain('第一段问题');
    expect(chatSends[1]?.prompt).toContain('第二段补充');

    fireEvent.click(rows[0]!);
    await waitFor(() => expect(rows[0]?.getAttribute('aria-pressed')).toBe('false'));
});

test('workspace places AI actions after recording controls in the composer row', async () => {
    const {api, chatSends, emitAsrResult, emitChatEvent} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    act(() => emitAsrResult({type: 'final', text: 'Question'}));
    await waitFor(() => expect(container.querySelector('.question-row')).toBeTruthy());
    await waitFor(() => expect(chatSends).toHaveLength(1));
    act(() => emitChatEvent({type: 'done', requestId: chatSends[0]!.requestId}));

    const actions = container.querySelector('.composer-actions')!;
    const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>('button'));
    const aiButtons = Array.from(actions.querySelectorAll<HTMLButtonElement>('.composer-ai-action'));
    const clearIndex = buttons.findIndex((button) => button.textContent?.trim() === '清空');

    expect(container.querySelector('.workspace-toolbar')).toBeNull();
    expect(aiButtons).toHaveLength(3);
    expect(aiButtons.every((button) => button.type === 'button' && buttons.indexOf(button) > clearIndex)).toBe(true);

    fireEvent.click(aiButtons[0]!);
    await waitFor(() => expect(chatSends).toHaveLength(2));
    expect(chatSends[1]?.prompt).toBe('Question');
    act(() => emitChatEvent({type: 'done', requestId: chatSends[1]!.requestId}));

    fireEvent.click(aiButtons[1]!);
    await waitFor(() => expect(chatSends).toHaveLength(3));
    expect(chatSends[2]?.prompt).toContain('追问');
    act(() => emitChatEvent({type: 'done', requestId: chatSends[2]!.requestId}));

    fireEvent.click(aiButtons[2]!);
    await waitFor(() => expect(chatSends).toHaveLength(4));
    expect(chatSends[3]?.prompt).toContain('重述');
});

test('workspace renders streamed answers as safe GFM Markdown and hides thinking text', async () => {
    const {api, chatSends, emitAsrResult, emitChatEvent} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    act(() => emitAsrResult({type: 'final', text: 'Question'}));
    await waitFor(() => expect(chatSends.length).toBe(1));

    act(() => emitChatEvent({
        type: 'chunk',
        requestId: chatSends[0]!.requestId,
        text: '<think>hidden reasoning</think>\n\n## Answer\n\n**bold**\n\n- item\n\n~~old~~\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst value = 1;\n```',
    }));

    await waitFor(() => expect(container.querySelector('.answer-markdown')).toBeTruthy());
    expect(container.querySelector('.answer-markdown h2')?.textContent).toBe('Answer');
    expect(container.querySelector('.answer-markdown strong')?.textContent).toBe('bold');
    expect(container.querySelector('.answer-markdown ul li')?.textContent).toBe('item');
    expect(container.querySelector('.answer-markdown del')?.textContent).toBe('old');
    expect(container.querySelector('.answer-markdown table')).toBeTruthy();
    expect(container.querySelector('.answer-markdown pre code')?.textContent).toContain('const value = 1;');
    expect(container.textContent).not.toContain('hidden reasoning');
    expect(container.querySelector('.answer-markdown think')).toBeNull();
});

test('workspace keeps incomplete reasoning hidden and does not execute raw HTML', async () => {
    const {api, chatSends, emitAsrResult, emitChatEvent} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);
    act(() => emitAsrResult({type: 'final', text: 'Question'}));
    await waitFor(() => expect(chatSends.length).toBe(1));

    act(() => emitChatEvent({
        type: 'chunk',
        requestId: chatSends[0]!.requestId,
        text: '<think>still thinking <script>alert(1)</script>',
    }));

    await waitFor(() => expect(container.querySelector('.answer-scroll')).toBeTruthy());
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).not.toContain('still thinking');
});

test('workspace uses the stored mixed input mode for a new recording session', async () => {
    const media = installWorkspaceAudioFakes();
    const {api} = fakeApi();
    window.meetingMonster = api;
    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'mixed');
    const {container} = render(<WorkspaceView active />);
    const {start, stop} = workspaceRecordButtons(container);

    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    await waitFor(() => expect(api.asr.start).toHaveBeenCalledWith(16000));
    expect(media.getDisplayMedia).toHaveBeenCalledOnce();
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    expect(media.getDisplayMedia.mock.invocationCallOrder[0]).toBeLessThan(api.asr.start.mock.invocationCallOrder[0]);
    expect(media.getUserMedia.mock.invocationCallOrder[0]).toBeLessThan(api.asr.start.mock.invocationCallOrder[0]);

    fireEvent.click(stop);
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
});

test('workspace maps a denied system capture to a safe permission message', async () => {
    const rawMessage = 'display capture secret stack details';
    installWorkspaceAudioFakes({displayError: audioPermissionError(rawMessage)});
    const {api} = fakeApi();
    window.meetingMonster = api;
    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    const {container} = render(<WorkspaceView active />);
    const {start} = workspaceRecordButtons(container);

    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('系统音频');
    expect(alert.textContent).toContain('权限');
    expect(alert.textContent).not.toContain(rawMessage);
    expect(alert.textContent).not.toContain('RAW STACK');
});

test('workspace maps a denied microphone capture to a safe permission message', async () => {
    const rawMessage = 'microphone capture secret stack details';
    installWorkspaceAudioFakes({microphoneError: audioPermissionError(rawMessage)});
    const {api} = fakeApi();
    window.meetingMonster = api;
    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'microphone');
    const {container} = render(<WorkspaceView active />);
    const {start} = workspaceRecordButtons(container);

    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('麦克风');
    expect(alert.textContent).toContain('权限');
    expect(alert.textContent).not.toContain(rawMessage);
    expect(alert.textContent).not.toContain('RAW STACK');
});

test('workspace applies a renderer-local input mode event to the next idle session', async () => {
    const media = installWorkspaceAudioFakes();
    const {api} = fakeApi();
    window.meetingMonster = api;
    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    const {container} = render(<WorkspaceView active />);
    const {start, stop} = workspaceRecordButtons(container);

    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledTimes(1));
    fireEvent.click(stop);
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledTimes(1));

    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'microphone');
    act(() => window.dispatchEvent(new Event(AUDIO_INPUT_MODE_EVENT)));
    await waitFor(() => expect(container.querySelector('.workspace-content')?.getAttribute('data-audio-input-mode')).toBe('microphone'));

    fireEvent.click(start);
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledTimes(2));
    expect(media.getDisplayMedia).toHaveBeenCalledOnce();
    expect(media.getUserMedia).toHaveBeenCalledOnce();
});

test('workspace stops local capture and ASR once when an input track ends, while retaining the error', async () => {
    const media = installWorkspaceAudioFakes();
    const {api} = fakeApi();
    window.meetingMonster = api;
    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    const {container} = render(<WorkspaceView active />);
    const {start} = workspaceRecordButtons(container);

    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledOnce());
    act(() => media.displayStream.getAudioTracks()[0]!.end());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('系统音频');
    expect(alert.textContent).toContain('已结束');
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
    expect(media.displayStream.getAudioTracks()[0]!.stopCalls).toBe(1);
    await waitFor(() => expect(start.disabled).toBe(false));
    expect(screen.getByRole('alert')).toBe(alert);
});

test('workspace retains the input-ended error when pending ASR start rejects after cleanup', async () => {
    let rejectAsrStart!: (error: Error) => void;
    const media = installWorkspaceAudioFakes();
    const {api} = fakeApi();
    api.asr.start = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectAsrStart = reject; }));
    window.meetingMonster = api;
    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    const {container} = render(<WorkspaceView active />);
    const {start} = workspaceRecordButtons(container);

    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledOnce());
    act(() => media.displayStream.getAudioTracks()[0]!.end());
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
    const inputEndedAlert = screen.getByRole('alert');
    expect(inputEndedAlert.textContent).toContain('已结束');

    await act(async () => {
        rejectAsrStart(new Error('late ASR start rejection'));
        await Promise.resolve();
        await Promise.resolve();
    });

    expect(api.asr.stop).toHaveBeenCalledOnce();
    expect(media.displayStream.getAudioTracks()[0]!.stopCalls).toBe(1);
    expect(screen.getByRole('alert').textContent).toContain('已结束');
    expect(screen.getByRole('alert').textContent).not.toContain('不可用');
});

test('workspace ignores a stale ASR start rejection after the next session begins', async () => {
    let rejectFirstAsrStart!: (error: Error) => void;
    const media = installWorkspaceAudioFakes();
    const {api} = fakeApi();
    api.asr.start = vi.fn()
        .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirstAsrStart = reject; }))
        .mockResolvedValueOnce(undefined);
    window.meetingMonster = api;
    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    const {container} = render(<WorkspaceView active />);
    const {start, stop} = workspaceRecordButtons(container);

    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledTimes(1));
    act(() => media.displayStream.getAudioTracks()[0]!.end());
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
    await waitFor(() => expect(start.disabled).toBe(false));

    window.localStorage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, 'microphone');
    act(() => window.dispatchEvent(new Event(AUDIO_INPUT_MODE_EVENT)));
    fireEvent.click(start);
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(stop.disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
        rejectFirstAsrStart(new Error('stale ASR start rejection'));
        await Promise.resolve();
        await Promise.resolve();
    });

    expect(api.asr.stop).toHaveBeenCalledOnce();
    expect(stop.disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(media.microphoneStream.getAudioTracks()[0]!.stopCalls).toBe(0);
});

test('one overlay app contains the capsule and panel without brand text and uses the favicon avatar', async () => {
    const {api} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<OverlayApp />);

    await waitFor(() => expect(container.querySelector('.capsule-shell')).toBeTruthy());
    expect(container.querySelector('.panel-shell')).toBeTruthy();
    expect(container.textContent).not.toContain('MEETING MONSTER');
    expect(container.querySelector('.capsule-avatar img')?.getAttribute('src')).toContain('favicon.png');
});
