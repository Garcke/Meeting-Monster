// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, test, vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CapsuleApp} from '../../desktop/ui/capsule/main';
import {WorkspaceMenu} from '../../desktop/ui/panel/WorkspaceMenu';
import {WorkspaceView} from '../../desktop/ui/panel/WorkspaceView';
import {OverlayApp} from '../../desktop/ui/overlay/main';
import type {AsrModelSnapshot, AsrStatus, ChatStreamEvent, MeetingMonsterApi, ModelSelectionInput, OverlaySnapshot, PrivacyStatus, SavedModelConnectionSettings, WorkspaceCommand} from '../../desktop/src/shared/contracts';
import {LEGACY_AUDIO_INPUT_MODE_STORAGE_KEY} from '../../desktop/ui/shared/services/audio-input-mode';

if (!globalThis.ResizeObserver) {
    class TestResizeObserver {
        public observe() {}
        public unobserve() {}
        public disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {configurable: true, value: TestResizeObserver});
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const panelStyles = fs.readFileSync(path.join(projectRoot, 'desktop', 'ui', 'panel', 'panel.css'), 'utf8');

const CAPSULE_CHAT_SYMBOL_PATH = 'M635.211887 354.085959c-236.873121 0-430.651342 311.057206-430.651342 430.651342 0 236.906195 193.778221 239.254421 430.651342 239.254421 236.873121 0 430.618269-2.381299 430.618269-239.221347 0-119.62721-193.745147-430.684416-430.618269-430.684416z m0 574.256912c-184.219951 0-334.936345 0-334.936344-143.572496 0-71.769711 150.716394-334.969418 334.936344-334.969419s334.936345 263.199707 334.936345 334.936345c0 167.484709-150.716394 143.539423-334.936345 143.539423v0.066147zM139.934731 258.404035A139.702885 139.702885 0 0 0 0.000331 398.305362a139.702885 139.702885 0 0 0 139.9344 139.967474 139.702885 139.702885 0 0 0 140.000548-139.934401A139.702885 139.702885 0 0 0 139.901658 258.370961z m0 193.745147a53.314643 53.314643 0 0 1-53.810747-53.810747c0-30.196197 23.680697-53.84382 53.810747-53.84382 30.196197 0 53.876894 23.680697 53.876894 53.84382a53.347716 53.347716 0 0 1-53.876894 53.843821z m979.739245-172.247307a139.702885 139.702885 0 0 0-139.967474 139.967474 139.702885 139.702885 0 0 0 139.967474 139.9344 139.702885 139.702885 0 0 0 139.967474-139.9344 139.702885 139.702885 0 0 0-139.967474-139.967474z m0 193.811294a53.314643 53.314643 0 0 1-53.84382-53.84382c0-30.163123 23.713771-53.810747 53.84382-53.810747 30.163123 0 53.810747 23.680697 53.810747 53.810747a53.347716 53.347716 0 0 1-53.810747 53.810746zM861.236868 21.49784a139.702885 139.702885 0 0 0-139.934401 139.967474 139.702885 139.702885 0 0 0 139.934401 139.967474 139.702885 139.702885 0 0 0 140.000548-139.967474A139.702885 139.702885 0 0 0 861.236868 21.49784z m0 193.811294a53.314643 53.314643 0 0 1-53.810747-53.810746c0-30.196197 23.680697-53.84382 53.810747-53.843821 30.196197 0 53.84382 23.680697 53.84382 53.843821A53.347716 53.347716 0 0 1 861.236868 215.309134zM452.182586 0C363.876075 0 290.717272 73.158803 290.717272 161.498388c0 88.240364 73.191876 161.465314 161.498388 161.465313s161.498388-73.191876 161.498387-161.498387S540.456024 0 452.182586 0z m0 236.840048c-40.912043 0-75.34166-34.462691-75.34166-75.34166 0-40.945116 34.429617-75.407807 75.34166-75.407808 40.945116 0 75.34166 34.462691 75.341661 75.407808 0 40.912043-34.429617 75.34166-75.308587 75.34166z';

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
    let overlayTarget: OverlaySnapshot['target'] = snapshot.target;
    const privacyListeners = new Set<(status: PrivacyStatus) => void>();
    const asrStatusListeners = new Set<(status: AsrStatus) => void>();
    const asrModelListeners = new Set<(snapshot: AsrModelSnapshot) => void>();
    const asrListeners = new Set<(event: {type: string; text: string}) => void>();
    const chatListeners = new Set<(event: ChatStreamEvent) => void>();
    const audioInputListeners = new Set<(mode: 'system' | 'microphone' | 'mixed') => void>();
    const modelListeners = new Set<() => void>();
    const workspaceCommandListeners = new Set<(command: WorkspaceCommand) => void>();
    const chatSends: Array<{requestId: string; prompt: string}> = [];
    const assistSends: Array<{requestId: string; selection?: ModelSelectionInput}> = [];
    const verifiedConnection = {
        profile_id: 'generic_openai' as const,
        protocol: 'openai' as const,
        base_url: 'https://openai.example/v1',
        model: 'vision-model',
        has_api_key: true,
        max_tokens: 2048,
        temperature: 0.3,
        vision_verified: true,
    };
    const api = {
        overlay: {
            intent: vi.fn(async ({type}: {type: 'toggle-workspace'}) => {
                intents.push({type});
                overlayTarget = overlayTarget === 'workspace' ? 'closed' : 'workspace';
                return {
                    target: overlayTarget,
                    phase: overlayTarget === 'workspace' ? 'opening' : 'closing',
                    revision: intents.length,
                } as OverlaySnapshot;
            }),
            getSnapshot: vi.fn(async () => snapshot),
            onSnapshot: vi.fn(() => () => {}),
            rendererReady: vi.fn(async (revision: number) => ({...snapshot, revision})),
            panelReady: vi.fn(async (revision: number) => ({...snapshot, revision})),
            animationFinished: vi.fn(async (revision: number) => ({...snapshot, revision})),
            onWindowError: vi.fn(() => () => {}),
        },
        workspaceCommands: {
            dispatch: vi.fn(async (command: WorkspaceCommand) => {
                for (const listener of workspaceCommandListeners) listener(command);
            }),
            onCommand: vi.fn((listener: (command: WorkspaceCommand) => void) => {
                workspaceCommandListeners.add(listener);
                return () => workspaceCommandListeners.delete(listener);
            }),
        },
        privacy: {
            getStatus: vi.fn(async () => privacyStatus),
            onStatus: vi.fn((listener: (status: PrivacyStatus) => void) => { privacyListeners.add(listener); return () => privacyListeners.delete(listener); }),
            setCaptureProtection: vi.fn(async () => privacy),
        },
        settings: {open: vi.fn(async () => undefined)},
        audioInput: {
            get: vi.fn(async () => 'system' as const),
            set: vi.fn(async (mode: 'system' | 'microphone' | 'mixed') => mode),
            onChanged: vi.fn((listener: (mode: 'system' | 'microphone' | 'mixed') => void) => {
                audioInputListeners.add(listener);
                return () => audioInputListeners.delete(listener);
            }),
        },
        asr: {
            getStatus: vi.fn(async () => ({state: 'idle' as const})),
            onStatus: vi.fn((listener: (status: AsrStatus) => void) => { asrStatusListeners.add(listener); return () => asrStatusListeners.delete(listener); }),
            onResult: vi.fn((listener: (event: {type: string; text: string}) => void) => { asrListeners.add(listener); return () => asrListeners.delete(listener); }),
            start: vi.fn(async () => undefined),
            stop: vi.fn(async () => undefined),
            writePcm: vi.fn(),
        },
        asrModels: {
            list: vi.fn(async () => {
                for (const listener of asrModelListeners) listener(asrModels);
                return asrModels;
            }),
            onStatus: vi.fn((listener: (snapshot: AsrModelSnapshot) => void) => { asrModelListeners.add(listener); return () => asrModelListeners.delete(listener); }),
        },
        models: {
            getSaved: vi.fn(async () => ({active_profile: 'generic_openai' as const, connections: {generic_openai: verifiedConnection}})),
            onChanged: vi.fn((listener: () => void) => { modelListeners.add(listener); return () => modelListeners.delete(listener); }),
        },
        chat: {
            onEvent: vi.fn((listener: (event: ChatStreamEvent) => void) => { chatListeners.add(listener); return () => chatListeners.delete(listener); }),
            send: vi.fn(async (requestId: string, prompt: string) => { chatSends.push({requestId, prompt}); }),
            assist: vi.fn(async (requestId: string, selection?: ModelSelectionInput) => { assistSends.push({requestId, selection}); return {requestId}; }),
            cancel: vi.fn(async () => undefined),
        },
        window: {hide: vi.fn(), show: vi.fn(), getState: vi.fn(), setExpanded: vi.fn(), toggleExpanded: vi.fn(), onState: vi.fn(), quit: vi.fn(async () => undefined)},
    } as unknown as MeetingMonsterApi;
    return {
        api,
        intents,
        chatSends,
        assistSends,
        emitAsrStatus: (status: AsrStatus) => { for (const listener of asrStatusListeners) listener(status); },
        emitAsrResult: (event: {type: string; text: string}) => { for (const listener of asrListeners) listener(event); },
        emitChatEvent: (event: ChatStreamEvent) => { for (const listener of chatListeners) listener(event); },
        emitAudioInputChanged: (mode: 'system' | 'microphone' | 'mixed') => { for (const listener of audioInputListeners) listener(mode); },
        emitModelChanged: () => { for (const listener of modelListeners) listener(); },
        emitPrivacy: (status: PrivacyStatus) => { for (const listener of privacyListeners) listener(status); },
        emitWorkspaceCommand: (command: WorkspaceCommand) => { for (const listener of workspaceCommandListeners) listener(command); },
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

function waitForWorkspaceRecordingReady() {
    return act(async () => { await Promise.resolve(); });
}

afterEach(() => {
    cleanup();
    restoreProperty(navigator, 'mediaDevices', originalMediaDevices);
    restoreProperty(window, 'AudioContext', originalAudioContext);
    restoreProperty(globalThis, 'AudioWorkletNode', originalAudioWorkletNode);
    vi.restoreAllMocks();
    window.localStorage.clear();
});

test('capsule sends only the workspace overlay intent from Chat', async () => {
    const {api, intents} = fakeApi();
    window.meetingMonster = api;
    render(<CapsuleApp />);
    fireEvent.click(await screen.findByRole('button', {name: /Chat/}));
    expect(intents).toEqual([{type: 'toggle-workspace'}]);
    expect(screen.queryByRole('button', {name: '设置'})).toBeNull();
});

test('capsule swaps its decorative Chat symbol for the Hide chevron with the workspace state', async () => {
    const {api} = fakeApi();
    window.meetingMonster = api;
    render(<CapsuleApp />);

    const chatButton = await screen.findByRole('button', {name: /Chat/});
    expect(chatButton.getAttribute('aria-expanded')).toBe('false');
    const chatSymbol = document.querySelector<SVGSVGElement>('.capsule-chat-symbol');
    expect(chatSymbol?.getAttribute('viewBox')).toBe('0 0 1259 1024');
    expect(chatSymbol?.getAttribute('aria-hidden')).toBe('true');
    expect(chatSymbol?.querySelector('path')?.getAttribute('d')).toBe(CAPSULE_CHAT_SYMBOL_PATH);

    fireEvent.click(chatButton);
    await waitFor(() => expect(screen.getByRole('button', {name: /Hide/}).getAttribute('aria-expanded')).toBe('true'));
    expect(document.querySelector('.capsule-chevron')).toBeTruthy();
    expect(document.querySelector('.capsule-chat-symbol')).toBeNull();

    fireEvent.click(screen.getByRole('button', {name: /Hide/}));
    await waitFor(() => expect(screen.getByRole('button', {name: /Chat/}).getAttribute('aria-expanded')).toBe('false'));
    expect(document.querySelector('.capsule-chevron')).toBeNull();
    const restoredChatSymbol = document.querySelector<SVGSVGElement>('.capsule-chat-symbol');
    expect(restoredChatSymbol?.getAttribute('viewBox')).toBe('0 0 1259 1024');
    expect(restoredChatSymbol?.querySelector('path')?.getAttribute('d')).toBe(CAPSULE_CHAT_SYMBOL_PATH);
});

test('capsule exposes only workspace and exit actions', async () => {
    const {api} = fakeApi();
    window.meetingMonster = api;
    render(<CapsuleApp />);

    expect(await screen.findByRole('button', {name: /Chat/})).toBeTruthy();
    expect((await screen.findByRole('button', {name: /Chat/})).getAttribute('aria-expanded')).toBe('false');
    const quit = screen.getByRole('button', {name: '退出 Meeting-Monster'});
    expect(quit).toBeTruthy();
    expect(quit.textContent).toBe('×');
    fireEvent.click(quit);
    expect(api.window.quit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', {name: '设置'})).toBeNull();
    expect(screen.queryByText(/已保护|未保护/)).toBeNull();
});

test('capsule renders each transcription state with its fixed label and indicator', async () => {
    const {api, emitAsrStatus} = fakeApi();
    window.meetingMonster = api;
    render(<CapsuleApp />);

    const expected: Record<AsrStatus['state'], string> = {
        idle: '就绪',
        connecting: '正在启动',
        recording: '正在转写',
        stopping: '正在停止',
        error: '转写异常',
    };

    for (const [state, label] of Object.entries(expected) as Array<[AsrStatus['state'], string]>) {
        act(() => emitAsrStatus({state}));
        await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
        expect(document.querySelector('.capsule-state-indicator')?.getAttribute('data-state')).toBe(state);
    }
});

test('workspace menu exposes Ant Design controls while preserving commands and shortcuts', async () => {
    const {api, emitAsrStatus} = fakeApi();
    window.meetingMonster = api;
    render(<OverlayApp />);
    act(() => emitAsrStatus({state: 'idle'}));

    fireEvent.click(await screen.findByRole('button', {name: '更多'}));
    expect(screen.getByRole('menu', {name: '工作区菜单'})).toBeTruthy();
    const visibilityReference = screen.getByText('显示/隐藏窗口');
    expect(visibilityReference.closest('[role="menuitem"]')).toBeTruthy();
    expect(screen.getByRole('menuitem', {name: /显示\/隐藏窗口/}).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('移动悬浮窗')).toBeTruthy();
    expect(screen.getByText('滚动聊天')).toBeTruthy();
    expect(screen.getByText('Ctrl+\\')).toBeTruthy();
    expect(screen.getByText('Ctrl+↑↓←→')).toBeTruthy();
    expect(screen.getByText('Ctrl+Shift+↑↓')).toBeTruthy();
    const transcription = screen.getByRole('switch', {name: '实时转写'});
    expect(transcription).toBeTruthy();
    expect(screen.getByRole('menuitem', {name: /清空聊天/})).toBeTruthy();
    expect(screen.getByText('Ctrl+R')).toBeTruthy();
    const privacySwitch = screen.getByRole('switch', {name: '应用隐藏'});
    expect(privacySwitch.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('截图保护')).toBeNull();
    expect(screen.getByText('开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。')).toBeTruthy();
    expect(screen.queryByText(/Ask/)).toBeNull();
    expect(screen.queryByText(/Stop session/)).toBeNull();

    await waitFor(() => expect((transcription as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(transcription);
    expect(api.workspaceCommands.dispatch).toHaveBeenCalledWith({type: 'toggle-transcription'});

    act(() => emitAsrStatus({state: 'recording'}));
    await waitFor(() => expect(screen.getByRole('switch', {name: '实时转写'}).getAttribute('aria-checked')).toBe('true'));
    act(() => emitAsrStatus({state: 'connecting'}));
    await waitFor(() => expect((screen.getByRole('switch', {name: '实时转写'}) as HTMLButtonElement).disabled).toBe(true));
    act(() => emitAsrStatus({state: 'stopping'}));
    await waitFor(() => expect((screen.getByRole('switch', {name: '实时转写'}) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole('menuitem', {name: /清空聊天/}));
    expect(api.workspaceCommands.dispatch).toHaveBeenCalledWith({type: 'clear-chat'});
});

test('workspace menu reports configured-but-failed screenshot protection as not enabled and retries protection', async () => {
    const failedPrivacy = {...privacy, captureProtection: 'failed' as const, captureProtectionEnabled: true};
    const {api} = fakeApi(failedPrivacy);
    window.meetingMonster = api;
    render(<OverlayApp />);

    expect(await screen.findByTestId('privacy-warning-dot')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', {name: '更多'}));
    const privacyItem = screen.getByRole('switch', {name: '应用隐藏'});
    expect(privacyItem.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(privacyItem);
    expect(api.privacy.setCaptureProtection).toHaveBeenCalledWith(true);
});

test('workspace menu closes with Escape and opens settings', async () => {
    const {api} = fakeApi();
    window.meetingMonster = api;
    render(<OverlayApp />);

    const more = await screen.findByRole('button', {name: '更多'});
    fireEvent.click(more);
    fireEvent.keyDown(document, {key: 'Escape'});
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', {name: /设置/}));
    await waitFor(() => expect(api.settings.open).toHaveBeenCalledOnce());
});

test('workspace menu surfaces settings failures with an Ant Design alert', async () => {
    const {api} = fakeApi();
    api.settings.open = vi.fn(async () => { throw new Error('settings unavailable'); });
    window.meetingMonster = api;
    render(<OverlayApp />);

    fireEvent.click(await screen.findByRole('button', {name: '更多'}));
    fireEvent.click(screen.getByRole('menuitem', {name: /设置/}));

    expect((await screen.findByRole('alert')).textContent).toContain('设置窗口无法打开');
});

test('capsule exit control quits the app instead of hiding it', async () => {
    const {api} = fakeApi();
    const quit = vi.fn(async () => undefined);
    (api.window as typeof api.window & {quit: typeof quit}).quit = quit;
    api.window.hide = vi.fn(async () => ({mode: 'capsule', visible: false}));
    window.meetingMonster = api;
    render(<CapsuleApp />);

    const exit = await screen.findByRole('button', {name: '退出 Meeting-Monster'});
    fireEvent.click(exit);

    expect(quit).toHaveBeenCalledOnce();
    expect(api.window.hide).not.toHaveBeenCalled();
});

test('workspace header omits the prompt pill while retaining drag affordances', async () => {
    const {api} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<OverlayApp />);

    await waitFor(() => expect(container.querySelector('.panel-drag-handle')).toBeTruthy());
    const header = container.querySelector('.panel-drag-handle');
    const transcript = container.querySelector('.workspace-transcript');
    const title = container.querySelector('.panel-kicker');

    expect(container.querySelector('.panel-prompt')).toBeNull();
    expect(header).toBeTruthy();
    expect(header?.hasAttribute('data-drag-handle')).toBe(true);
    expect(title?.textContent).toBe('TRANSCRIPT');
    expect(title?.className).toBe('panel-kicker');
    expect(title?.closest('.panel-drag-handle')).toBe(header);
    expect(container.querySelector('.panel-drag-hint')).toBeNull();
    expect(screen.queryByText('\u62d6\u52a8\u9762\u677f')).toBeNull();
    expect(transcript?.querySelector('.panel-prompt')).toBeNull();
    expect(transcript?.querySelector('.empty-copy')).toBeNull();
    expect(transcript?.textContent).not.toContain('\u5f00\u59cb\u8f6c\u5199\u540e\uff0c\u5f53\u524d\u95ee\u9898\u4f1a\u663e\u793a\u5728\u8fd9\u91cc');
});

test('panel drag handle uses the standard cursor', async () => {
    const style = document.createElement('style');
    style.textContent = panelStyles;
    document.head.append(style);
    try {
        const {api} = fakeApi();
        window.meetingMonster = api;
        const {container} = render(<OverlayApp />);
        const header = await waitFor(() => {
            const element = container.querySelector('.panel-drag-handle');
            expect(element).toBeTruthy();
            return element as Element;
        });

        expect(window.getComputedStyle(header).cursor).toBe('default');
    } finally {
        style.remove();
    }
});

test('workspace automatically selects ASR fragments and waits for manual submission', async () => {
    const {api, chatSends, assistSends, emitAsrResult} = fakeApi();
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
    expect(chatSends).toHaveLength(0);
    expect(assistSends).toHaveLength(0);

    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(chatSends).toHaveLength(1));
    expect(chatSends[0]?.prompt.indexOf('第一段问题')).toBeLessThan(chatSends[0]?.prompt.indexOf('第二段补充') ?? -1);

    fireEvent.click(rows[0]!);
    await waitFor(() => expect(rows[0]?.getAttribute('aria-pressed')).toBe('false'));
});

test('workspace runs screenshot Assist without transcript content', async () => {
    const {api, chatSends, assistSends, emitChatEvent} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    const assist = await screen.findByRole('button', {name: '✦ Assist'}) as HTMLButtonElement;
    await waitFor(() => expect(api.models.getSaved).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByText('请在设置中验证图片能力')).toBeNull());
    await waitFor(() => expect(assist.disabled).toBe(false));
    expect(container.querySelectorAll('.question-row')).toHaveLength(0);

    fireEvent.click(assist);
    await waitFor(() => expect(assistSends).toHaveLength(1));
    expect(assistSends[0]).toEqual({requestId: expect.any(String), selection: undefined});
    expect(chatSends).toHaveLength(0);

    act(() => emitChatEvent({
        type: 'chunk',
        requestId: assistSends[0]!.requestId,
        text: 'Screenshot answer',
    }));
    expect(await screen.findByText('Screenshot answer')).toBeTruthy();
    expect(container.querySelectorAll('.question-row')).toHaveLength(0);
    act(() => emitChatEvent({type: 'done', requestId: assistSends[0]!.requestId}));
});

test('workspace keeps screenshot Assist separate from a selected transcript answer', async () => {
    const {api, chatSends, assistSends, emitAsrResult, emitChatEvent} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    act(() => emitAsrResult({type: 'final', text: 'Transcript question'}));
    await waitFor(() => expect(container.querySelector('.question-row')).toBeTruthy());
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(chatSends).toHaveLength(1));
    act(() => emitChatEvent({type: 'chunk', requestId: chatSends[0]!.requestId, text: 'Transcript answer'}));
    act(() => emitChatEvent({type: 'done', requestId: chatSends[0]!.requestId}));
    expect(await screen.findByText('Transcript answer')).toBeTruthy();

    const assist = screen.getByRole('button', {name: '✦ Assist'});
    await waitFor(() => expect((assist as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(assist);
    await waitFor(() => expect(assistSends).toHaveLength(1));
    expect(assistSends[0]).toEqual({requestId: expect.any(String), selection: undefined});
    act(() => emitChatEvent({type: 'chunk', requestId: assistSends[0]!.requestId, text: 'Screenshot answer'}));
    act(() => emitChatEvent({type: 'done', requestId: assistSends[0]!.requestId}));
    expect(await screen.findByText('Screenshot answer')).toBeTruthy();

    const row = container.querySelector<HTMLButtonElement>('.question-row')!;
    fireEvent.click(row);
    fireEvent.click(row);
    expect(await screen.findByText('Transcript answer')).toBeTruthy();
});

test('workspace toggles transcription from workspace commands', async () => {
    installWorkspaceAudioFakes();
    const {api, emitWorkspaceCommand} = fakeApi();
    window.meetingMonster = api;
    render(<WorkspaceView active />);

    await waitFor(() => expect(api.asrModels.list).toHaveBeenCalledOnce());
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledWith(16000));
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
});

test('capsule reflects a renderer-originated transcription failure', async () => {
    installWorkspaceAudioFakes({displayError: audioPermissionError('display capture denied')});
    const {api, emitWorkspaceCommand} = fakeApi();
    window.meetingMonster = api;
    render(<OverlayApp />);

    await waitFor(() => expect(api.asrModels.list).toHaveBeenCalled());
    await screen.findByText('就绪');
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));

    await screen.findByText('转写异常');
});

test('workspace clears chat from a command without stopping transcription', async () => {
    installWorkspaceAudioFakes();
    const {api, chatSends, emitAsrResult, emitWorkspaceCommand} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    await waitFor(() => expect(api.asrModels.list).toHaveBeenCalledOnce());
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledWith(16000));
    act(() => emitAsrResult({type: 'final', text: 'Question'}));
    await waitFor(() => expect(container.querySelector('.question-row')).toBeTruthy());
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(chatSends).toHaveLength(1));

    act(() => emitWorkspaceCommand({type: 'clear-chat'}));

    expect(container.querySelector('.question-row')).toBeNull();
    expect(api.chat.cancel).toHaveBeenCalledOnce();
    expect(api.asr.stop).not.toHaveBeenCalled();
});

test('workspace scroll commands move the answer in opposite directions', async () => {
    const {api, emitWorkspaceCommand} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);
    const answerScroll = container.querySelector<HTMLDivElement>('.answer-scroll')!;
    const scrollBy = vi.fn();
    Object.defineProperty(answerScroll, 'clientHeight', {configurable: true, value: 300});
    Object.defineProperty(answerScroll, 'scrollBy', {configurable: true, value: scrollBy});

    act(() => emitWorkspaceCommand({type: 'scroll-chat', direction: 'up'}));
    act(() => emitWorkspaceCommand({type: 'scroll-chat', direction: 'down'}));

    expect(scrollBy).toHaveBeenNthCalledWith(1, expect.objectContaining({top: -180}));
    expect(scrollBy).toHaveBeenNthCalledWith(2, expect.objectContaining({top: 180}));
});

test('workspace keeps only AI actions in the composer row', async () => {
    const {api, chatSends, assistSends, emitAsrResult, emitChatEvent} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    act(() => emitAsrResult({type: 'final', text: 'Question'}));
    await waitFor(() => expect(container.querySelector('.question-row')).toBeTruthy());
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(chatSends).toHaveLength(1));
    act(() => emitChatEvent({type: 'done', requestId: chatSends[0]!.requestId}));

    const actions = container.querySelector('.composer-actions')!;
    const aiButtons = Array.from(actions.querySelectorAll<HTMLButtonElement>('.composer-ai-action'));

    expect(container.querySelector('.workspace-toolbar')).toBeNull();
    expect(aiButtons).toHaveLength(3);
    expect(actions.querySelector('.record-action')).toBeNull();
    expect(actions.textContent).not.toContain('开始转写');
    expect(actions.textContent).not.toContain('停止');
    expect(actions.textContent).not.toContain('清空');
    expect(aiButtons.every((button) => button.type === 'button')).toBe(true);

    fireEvent.click(aiButtons[0]!);
    await waitFor(() => expect(assistSends).toHaveLength(1));
    expect(assistSends[0]).toEqual({requestId: expect.any(String), selection: undefined});
    expect(chatSends).toHaveLength(1);
    act(() => emitChatEvent({type: 'done', requestId: assistSends[0]!.requestId}));

    fireEvent.click(aiButtons[1]!);
    await waitFor(() => expect(chatSends).toHaveLength(2));
    expect(chatSends[1]?.prompt).toContain('追问');
    expect(assistSends).toHaveLength(1);
    act(() => emitChatEvent({type: 'done', requestId: chatSends[1]!.requestId}));

    fireEvent.click(aiButtons[2]!);
    await waitFor(() => expect(chatSends).toHaveLength(3));
    expect(chatSends[2]?.prompt).toContain('重述');
    expect(assistSends).toHaveLength(1);
});

test('workspace disables Assist until a verified model and a selected question exist', async () => {
    const {api, emitAsrResult} = fakeApi();
    api.models.getSaved = vi.fn(async () => ({
        active_profile: 'generic_openai',
        connections: {generic_openai: {
            profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://openai.example/v1',
            model: 'legacy-model', has_api_key: true, max_tokens: 2048, temperature: 0.3,
            vision_verified: false,
        }},
    }));
    window.meetingMonster = api;
    render(<WorkspaceView active />);

    const assist = await screen.findByRole('button', {name: '✦ Assist'}) as HTMLButtonElement;
    expect(assist.disabled).toBe(true);
    act(() => emitAsrResult({type: 'final', text: 'Question'}));
    await waitFor(() => expect(screen.getByText('请在设置中验证图片能力')).toBeTruthy());
    expect(assist.disabled).toBe(true);
});

test('workspace shows capture then generation status for screenshot Assist', async () => {
    let resolveAssist!: (value: {requestId: string}) => void;
    const {api, chatSends, assistSends, emitAsrResult, emitChatEvent} = fakeApi();
    api.chat.assist = vi.fn((requestId: string) => {
        assistSends.push({requestId});
        return new Promise<{requestId: string}>((resolve) => { resolveAssist = resolve; });
    });
    window.meetingMonster = api;
    render(<WorkspaceView active />);
    act(() => emitAsrResult({type: 'final', text: 'Question'}));
    await waitFor(() => expect(document.querySelector('.question-row')).toBeTruthy());
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(chatSends).toHaveLength(1));
    act(() => emitChatEvent({type: 'done', requestId: chatSends[0]!.requestId}));
    await waitFor(() => expect((screen.getByRole('button', {name: '✦ Assist'}) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', {name: '✦ Assist'}));
    await waitFor(() => expect(screen.getByText('正在截图')).toBeTruthy());
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.composer-ai-action')).every((button) => button.disabled)).toBe(true);
    const requestId = assistSends[0]!.requestId;
    await act(async () => resolveAssist({requestId}));
    await waitFor(() => expect(screen.getByText('等待生成')).toBeTruthy());
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.composer-ai-action')).every((button) => button.disabled)).toBe(true);
    act(() => emitChatEvent({type: 'done', requestId}));
    await waitFor(() => expect(screen.queryByText('等待生成')).toBeNull());
    expect((screen.getByRole('button', {name: '✦ Assist'}) as HTMLButtonElement).disabled).toBe(false);
});

test('workspace reloads verified model capability after main-process model change', async () => {
    const {api, emitModelChanged} = fakeApi();
    window.meetingMonster = api;
    render(<WorkspaceView active />);
    await screen.findByText(/当前：/);
    api.models.getSaved = vi.fn(async () => ({
        active_profile: 'generic_anthropic' as const,
        connections: {
            generic_anthropic: {
                profile_id: 'generic_anthropic' as const,
                protocol: 'anthropic' as const,
                base_url: 'https://provider.example/v1',
                model: 'test-model',
                has_api_key: false,
                max_tokens: 2048,
                temperature: 0.3,
                vision_verified: true,
            },
        },
    }));
    act(() => emitModelChanged());
    await waitFor(() => expect(screen.getByText(/Anthropic Compatible/)).toBeTruthy());
});

test('workspace ignores an older model settings refresh that resolves after the latest one', async () => {
    let resolveOlder!: (value: SavedModelConnectionSettings) => void;
    let resolveLatest!: (value: SavedModelConnectionSettings) => void;
    const older = new Promise<SavedModelConnectionSettings>((resolve) => { resolveOlder = resolve; });
    const latest = new Promise<SavedModelConnectionSettings>((resolve) => { resolveLatest = resolve; });
    const {api, emitModelChanged} = fakeApi();
    const unverified = {
        profile_id: 'generic_openai' as const, protocol: 'openai' as const, base_url: 'https://openai.example/v1',
        model: 'vision-model', has_api_key: true, max_tokens: 2048, temperature: 0.3, vision_verified: false,
    };
    const verified = {...unverified, vision_verified: true};
    api.models.getSaved = vi.fn()
        .mockImplementationOnce(() => older)
        .mockImplementationOnce(() => latest);
    window.meetingMonster = api;
    render(<WorkspaceView active />);
    await waitFor(() => expect(api.models.getSaved).toHaveBeenCalledOnce());

    act(() => emitModelChanged());
    await waitFor(() => expect(api.models.getSaved).toHaveBeenCalledTimes(2));
    await act(async () => resolveLatest({active_profile: 'generic_openai', connections: {generic_openai: verified}}));
    await waitFor(() => expect(screen.queryByText('请在设置中验证图片能力')).toBeNull());

    await act(async () => resolveOlder({active_profile: 'generic_openai', connections: {generic_openai: unverified}}));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText('请在设置中验证图片能力')).toBeNull();
});

test('manual form submission remains text-only', async () => {
    const {api, chatSends, assistSends} = fakeApi();
    window.meetingMonster = api;
    render(<WorkspaceView active />);
    await userEvent.setup().type(screen.getByRole('textbox', {name: '输入问题'}), 'Manual question');
    fireEvent.click(screen.getByRole('button', {name: '发送'}));
    await waitFor(() => expect(chatSends).toHaveLength(1));
    expect(chatSends[0]?.prompt).toBe('Manual question');
    expect(assistSends).toHaveLength(0);
});

test('workspace renders streamed answers as safe GFM Markdown and hides thinking text', async () => {
    const {api, chatSends, emitAsrResult, emitChatEvent} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    act(() => emitAsrResult({type: 'final', text: 'Question'}));
    await waitFor(() => expect(container.querySelector('.question-row')).toBeTruthy());
    fireEvent.submit(container.querySelector('form')!);
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
    await waitFor(() => expect(container.querySelector('.question-row')).toBeTruthy());
    fireEvent.submit(container.querySelector('form')!);
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

test('workspace migrates the legacy input preference once and uses the saved mode for recording', async () => {
    const media = installWorkspaceAudioFakes();
    const {api, emitWorkspaceCommand} = fakeApi();
    window.meetingMonster = api;
    window.localStorage.setItem(LEGACY_AUDIO_INPUT_MODE_STORAGE_KEY, 'mixed');
    render(<WorkspaceView active />);

    await waitFor(() => expect(api.asrModels.list).toHaveBeenCalledOnce());
    await waitFor(() => expect(api.audioInput.set).toHaveBeenCalledWith('mixed'));
    expect(window.localStorage.getItem(LEGACY_AUDIO_INPUT_MODE_STORAGE_KEY)).toBeNull();
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));

    await waitFor(() => expect(api.asr.start).toHaveBeenCalledWith(16000));
    expect(media.getDisplayMedia).toHaveBeenCalledOnce();
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    expect(media.getDisplayMedia.mock.invocationCallOrder[0]).toBeLessThan(api.asr.start.mock.invocationCallOrder[0]);
    expect(media.getUserMedia.mock.invocationCallOrder[0]).toBeLessThan(api.asr.start.mock.invocationCallOrder[0]);

    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
});

test('workspace maps a denied system capture to a safe permission message', async () => {
    const rawMessage = 'display capture secret stack details';
    installWorkspaceAudioFakes({displayError: audioPermissionError(rawMessage)});
    const {api, emitWorkspaceCommand} = fakeApi();
    window.meetingMonster = api;
    window.localStorage.setItem(LEGACY_AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    render(<WorkspaceView active />);

    await waitFor(() => expect(api.asrModels.list).toHaveBeenCalledOnce());
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('系统音频');
    expect(alert.textContent).toContain('权限');
    expect(alert.textContent).not.toContain(rawMessage);
    expect(alert.textContent).not.toContain('RAW STACK');
});

test('workspace maps a denied microphone capture to a safe permission message', async () => {
    const rawMessage = 'microphone capture secret stack details';
    installWorkspaceAudioFakes({microphoneError: audioPermissionError(rawMessage)});
    const {api, emitWorkspaceCommand} = fakeApi();
    window.meetingMonster = api;
    window.localStorage.setItem(LEGACY_AUDIO_INPUT_MODE_STORAGE_KEY, 'microphone');
    render(<WorkspaceView active />);

    await waitFor(() => expect(api.asrModels.list).toHaveBeenCalledOnce());
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('麦克风');
    expect(alert.textContent).toContain('权限');
    expect(alert.textContent).not.toContain(rawMessage);
    expect(alert.textContent).not.toContain('RAW STACK');
});

test('workspace uses a later audio input change for the next idle session', async () => {
    const media = installWorkspaceAudioFakes();
    const {api, emitAudioInputChanged, emitWorkspaceCommand} = fakeApi();
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    await waitFor(() => expect(api.asrModels.list).toHaveBeenCalledOnce());
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledTimes(1));
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledTimes(1));

    act(() => emitAudioInputChanged('microphone'));
    await waitFor(() => expect(container.querySelector('.workspace-content')?.getAttribute('data-audio-input-mode')).toBe('microphone'));

    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledTimes(2));
    expect(media.getDisplayMedia).toHaveBeenCalledOnce();
    expect(media.getUserMedia).toHaveBeenCalledOnce();
});

test('workspace does not let a delayed saved mode overwrite a newer audio input change', async () => {
    let resolveSavedMode!: (mode: 'system' | 'microphone' | 'mixed') => void;
    const {api, emitAudioInputChanged} = fakeApi();
    api.audioInput.get = vi.fn(() => new Promise((resolve) => { resolveSavedMode = resolve; }));
    window.meetingMonster = api;
    const {container} = render(<WorkspaceView active />);

    await waitFor(() => expect(api.audioInput.onChanged).toHaveBeenCalledOnce());
    act(() => emitAudioInputChanged('microphone'));
    await waitFor(() => expect(container.querySelector('.workspace-content')?.getAttribute('data-audio-input-mode')).toBe('microphone'));

    await act(async () => { resolveSavedMode('system'); });

    expect(container.querySelector('.workspace-content')?.getAttribute('data-audio-input-mode')).toBe('microphone');
});

test('workspace stops local capture and ASR once when an input track ends, while retaining the error', async () => {
    const media = installWorkspaceAudioFakes();
    const {api, emitWorkspaceCommand} = fakeApi();
    window.meetingMonster = api;
    window.localStorage.setItem(LEGACY_AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    const {container} = render(<WorkspaceView active />);

    await waitFor(() => expect(api.asrModels.list).toHaveBeenCalledOnce());
    await waitForWorkspaceRecordingReady();
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledOnce());
    act(() => media.displayStream.getAudioTracks()[0]!.end());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('系统音频');
    expect(alert.textContent).toContain('已结束');
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
    expect(media.displayStream.getAudioTracks()[0]!.stopCalls).toBe(1);
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
    expect(screen.getByRole('alert')).toBe(alert);
});

test('workspace retains the input-ended error when pending ASR start rejects after cleanup', async () => {
    let rejectAsrStart!: (error: Error) => void;
    const media = installWorkspaceAudioFakes();
    const {api, emitWorkspaceCommand} = fakeApi();
    api.asr.start = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectAsrStart = reject; }));
    window.meetingMonster = api;
    window.localStorage.setItem(LEGACY_AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    render(<WorkspaceView active />);

    await waitFor(() => expect(api.asrModels.list).toHaveBeenCalledOnce());
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
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
    const {api, emitAudioInputChanged, emitWorkspaceCommand} = fakeApi();
    api.asr.start = vi.fn()
        .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirstAsrStart = reject; }))
        .mockResolvedValueOnce(undefined);
    window.meetingMonster = api;
    window.localStorage.setItem(LEGACY_AUDIO_INPUT_MODE_STORAGE_KEY, 'system');
    render(<><WorkspaceMenu /><WorkspaceView active /></>);

    fireEvent.click(await screen.findByRole('button', {name: '更多'}));
    const transcription = screen.getByRole('switch', {name: '实时转写'}) as HTMLButtonElement;
    await waitFor(() => expect(transcription.disabled).toBe(false));
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledTimes(1));
    act(() => media.displayStream.getAudioTracks()[0]!.end());
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
    await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());

    act(() => emitAudioInputChanged('microphone'));
    act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.asr.start).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
        rejectFirstAsrStart(new Error('stale ASR start rejection'));
        await Promise.resolve();
        await Promise.resolve();
    });

    expect(api.asr.stop).toHaveBeenCalledOnce();
    expect(api.asr.start).toHaveBeenCalledTimes(2);
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
