// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {SettingsApp} from '../../desktop/ui/settings/SettingsApp';
import {ModelSettingsPage} from '../../desktop/ui/settings/ModelSettingsPage';
import {SpeechSettingsPage} from '../../desktop/ui/settings/SpeechSettingsPage';
import type {AsrModelSnapshot, PrivacyStatus, SavedModelConnectionSettings, SettingsRendererApi} from '../../desktop/src/shared/contracts';

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

const privacy: PrivacyStatus = {captureProtection: 'protected', captureProtectionEnabled: true, platform: 'win32', windowCount: 1};
const asrModels: AsrModelSnapshot = {
    currentModelId: 'streaming-paraformer-bilingual-zh-en',
    models: [
        {id: 'streaming-paraformer-bilingual-zh-en', label: 'Streaming Paraformer (Chinese + English)', languages: ['zh', 'en'], description: 'Paraformer', estimatedBytes: 226_000_000, supportsHotwords: false, installedState: 'installed', isCurrent: true, downloadedBytes: 226_000_000, totalBytes: 226_000_000},
        {id: 'streaming-zipformer-zh-int8-2025-06-30', label: 'Streaming Zipformer (Chinese)', languages: ['zh'], description: 'Zipformer', estimatedBytes: 180_000_000, supportsHotwords: false, installedState: 'not-downloaded', isCurrent: false, downloadedBytes: 0, totalBytes: 180_000_000},
    ],
};
const saved: SavedModelConnectionSettings = {
    active_profile: 'generic_openai',
    connections: {
        generic_openai: {
            profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://openai.example/v1', model: 'vision-model',
            has_api_key: true, max_tokens: 2048, temperature: 0.3, vision_verified: true,
        },
    },
};

function fakeSettingsApi(privacyStatus: PrivacyStatus = privacy) {
    const audioInputListeners = new Set<(mode: 'system' | 'microphone' | 'mixed') => void>();
    const asrStatusListeners = new Set<(snapshot: AsrModelSnapshot) => void>();
    const api = {
        settings: {
            close: vi.fn(async () => undefined),
            getAppVersion: vi.fn(async () => '2.2.5'),
        },
        privacy: {getStatus: vi.fn(async () => privacyStatus)},
        audioInput: {
            get: vi.fn(async () => 'system' as const),
            set: vi.fn(async (mode: 'system' | 'microphone' | 'mixed') => mode),
            onChanged: vi.fn((listener: (mode: 'system' | 'microphone' | 'mixed') => void) => {
                audioInputListeners.add(listener);
                return () => audioInputListeners.delete(listener);
            }),
        },
        models: {
            list: vi.fn(async () => ({active_profile: 'generic_openai', profiles: []})),
            getSaved: vi.fn(async () => saved),
            save: vi.fn(async () => saved),
            test: vi.fn(async () => ({ok: true, model: 'vision-model', latency_ms: 12})),
            onTestProgress: vi.fn(() => () => {}),
        },
        asrModels: {
            list: vi.fn(async () => asrModels),
            select: vi.fn(async () => asrModels),
            download: vi.fn(async () => asrModels),
            cancel: vi.fn(async () => ({cancelled: true})),
            delete: vi.fn(async () => asrModels),
            onStatus: vi.fn((listener: (snapshot: AsrModelSnapshot) => void) => {
                asrStatusListeners.add(listener);
                return () => asrStatusListeners.delete(listener);
            }),
        },
    } satisfies SettingsRendererApi;
    return {
        api,
        emitAudioInputChanged: (mode: 'system' | 'microphone' | 'mixed') => { for (const listener of audioInputListeners) listener(mode); },
        emitAsrStatus: (snapshot: AsrModelSnapshot) => { for (const listener of asrStatusListeners) listener(snapshot); },
    };
}

function selectedComboboxText(name: string) {
    const combobox = screen.getByRole('combobox', {name});
    fireEvent.mouseDown(combobox);
    return screen.getByRole('option', {selected: true}).getAttribute('aria-label') ?? '';
}

async function chooseOption(name: string, optionName: string) {
    const combobox = screen.getByRole('combobox', {name});
    fireEvent.mouseDown(combobox);
    fireEvent.keyDown(combobox, {key: 'ArrowDown'});
    fireEvent.click(await screen.findByText(optionName));
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'meetingMonsterSettings');
});

test('settings shell switches pages, exposes the app version, and closes through IPC', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<SettingsApp />);

    expect(document.querySelector('.settings-titlebar')).toBeTruthy();
    expect(screen.getByRole('button', {name: /\u5173\u95ed\u8bbe\u7f6e/})).toBeTruthy();
    expect(await screen.findByText('Meeting-Monster v2.2.5')).toBeTruthy();
    expect(screen.getByRole('heading', {name: 'AI 与模型'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: '语音与转写'}));
    expect(screen.getByRole('heading', {name: '语音与转写'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: '关闭设置'}));
    expect(api.settings.close).toHaveBeenCalledOnce();
});

test('settings pages render compact model and speech controls without overlay navigation', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    const {rerender} = render(<ModelSettingsPage active />);
    expect(await screen.findByLabelText('API Key')).toBeTruthy();
    expect(screen.getByLabelText('模型')).toBeTruthy();

    rerender(<SpeechSettingsPage active />);
    expect(await screen.findByLabelText('识别模型')).toBeTruthy();
    expect(screen.queryByText('拖动面板')).toBeNull();
});

test('settings exposes labeled Ant Design-compatible form semantics', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    const {rerender} = render(<ModelSettingsPage active />);

    expect(screen.getByRole('button', {name: '测试连接'})).toBeTruthy();
    expect(screen.getByRole('spinbutton', {name: '最大 Token'})).toBeTruthy();

    rerender(<SpeechSettingsPage active />);
    expect(await screen.findByRole('combobox', {name: '音频来源'})).toBeTruthy();
});

test('settings preserves blank numeric model fields when saving', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<ModelSettingsPage active />);

    await screen.findByText('已保存：OpenAI Compatible');
    const maxTokens = screen.getByRole('spinbutton', {name: '最大 Token'}) as HTMLInputElement;
    const temperature = screen.getByRole('spinbutton', {name: '温度'}) as HTMLInputElement;
    fireEvent.change(maxTokens, {target: {value: ''}});
    fireEvent.change(temperature, {target: {value: ''}});
    expect(maxTokens.value).toBe('');
    expect(temperature.value).toBe('');
    fireEvent.click(screen.getByRole('button', {name: '保存连接'}));

    await waitFor(() => expect(api.models.save).toHaveBeenCalledWith(expect.objectContaining({max_tokens: 4096})));
    expect(api.models.save.mock.calls[0]?.[0]).not.toHaveProperty('temperature');
});

test('settings marks a pending save action as busy and disabled', async () => {
    let resolveSave!: (value: SavedModelConnectionSettings) => void;
    const {api} = fakeSettingsApi();
    api.models.save = vi.fn(() => new Promise<SavedModelConnectionSettings>((resolve) => { resolveSave = resolve; }));
    window.meetingMonsterSettings = api;
    render(<ModelSettingsPage active />);

    await screen.findByText('已保存：OpenAI Compatible');
    fireEvent.click(screen.getByRole('button', {name: '保存连接'}));
    const saveButton = screen.getByRole('button', {name: /连接模型/}) as HTMLButtonElement;
    expect(saveButton.getAttribute('aria-busy')).toBe('true');
    expect(saveButton.disabled).toBe(true);

    act(() => resolveSave(saved));
    await waitFor(() => expect(saveButton.disabled).toBe(false));
});

test('settings exposes only the two compatible protocol options and keeps independent form snapshots', async () => {
    const {api} = fakeSettingsApi();
    api.models.getSaved = vi.fn(async () => ({
        active_profile: 'generic_openai',
        connections: {
            generic_openai: {
                profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://openai.example/v1',
                model: 'openai-model', has_api_key: true, max_tokens: 2048, temperature: 0.2,
            },
        },
    }));
    window.meetingMonsterSettings = api;
    render(<ModelSettingsPage active />);

    await screen.findByRole('combobox', {name: 'API 协议'});
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'API 协议'}));
    expect(screen.getAllByText('OpenAI Compatible').length).toBeGreaterThan(0);
    expect(screen.getByText('Anthropic Compatible')).toBeTruthy();
    expect(screen.queryByText(/MiniMax|Moonshot|GLM|OpenRouter|Vercel|OpenCode/)).toBeNull();
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://openai.example/v1');
    expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('openai-model');

    await chooseOption('API 协议', 'Anthropic Compatible');
    fireEvent.change(screen.getByLabelText('Base URL'), {target: {value: 'https://anthropic.example'}});
    fireEvent.change(screen.getByLabelText('Model ID'), {target: {value: 'anthropic-model'}});
    await chooseOption('API 协议', 'OpenAI Compatible');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://openai.example/v1');
    expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('openai-model');
});

test('settings hydration preserves fields touched before the saved model request resolves', async () => {
    let resolveSaved!: (value: SavedModelConnectionSettings) => void;
    const delayedSaved = new Promise<SavedModelConnectionSettings>((resolve) => { resolveSaved = resolve; });
    const {api} = fakeSettingsApi();
    api.models.getSaved = vi.fn(() => delayedSaved);
    window.meetingMonsterSettings = api;
    render(<ModelSettingsPage active />);

    const baseUrl = screen.getByLabelText('Base URL') as HTMLInputElement;
    const apiKey = screen.getByLabelText('API Key') as HTMLInputElement;
    fireEvent.change(baseUrl, {target: {value: 'https://typed.example/v1'}});
    fireEvent.change(apiKey, {target: {value: 'not-a-real-key'}});

    act(() => resolveSaved({
        ...saved,
        connections: {
            ...saved.connections,
            generic_anthropic: {
                profile_id: 'generic_anthropic', protocol: 'anthropic', base_url: 'https://hydrated.example/v1', model: 'hydrated-model',
                has_api_key: false, max_tokens: 1024, temperature: 0.4,
            },
        },
    }));
    await screen.findByText('已保存：OpenAI Compatible');

    expect(baseUrl.value).toBe('https://typed.example/v1');
    expect(apiKey.value).toBe('not-a-real-key');
    await chooseOption('API 协议', 'Anthropic Compatible');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://hydrated.example/v1');
});

test('settings blocks save before IPC when Base URL or Model ID is invalid', async () => {
    const {api} = fakeSettingsApi();
    api.models.getSaved = vi.fn(async () => ({active_profile: 'generic_openai', connections: {}}));
    api.models.save = vi.fn(async () => ({active_profile: 'generic_openai', connections: {}}));
    window.meetingMonsterSettings = api;
    render(<ModelSettingsPage active />);
    await screen.findByLabelText('API 协议');
    fireEvent.change(screen.getByLabelText('Base URL'), {target: {value: 'file:///not-http'}});
    fireEvent.click(screen.getByRole('button', {name: '保存连接'}));
    expect(api.models.save).not.toHaveBeenCalled();
});

test('settings confirms successful multimodal verification saves without renderer broadcasts', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<ModelSettingsPage active />);
    await screen.findByLabelText('API 协议');
    fireEvent.click(screen.getByRole('button', {name: '保存连接'}));

    await waitFor(() => expect(api.models.save).toHaveBeenCalledOnce());
    expect(screen.getByText('多模态能力验证成功')).toBeTruthy();
});

test('settings shows a safe status-aware diagnostic when model verification fails', async () => {
    const {api} = fakeSettingsApi();
    api.models.test = vi.fn(async () => {
        throw {
            code: 'authentication_failed',
            providerStatus: 401,
            message: 'provider body must never be displayed',
        };
    });
    window.meetingMonsterSettings = api;
    render(<ModelSettingsPage active />);

    await screen.findByLabelText('API 协议');
    fireEvent.click(screen.getByRole('button', {name: '测试连接'}));

    expect((await screen.findByRole('alert')).textContent).toContain('认证失败（HTTP 401）：请检查 API Key 或账号区域');
    expect(screen.queryByText('provider body must never be displayed')).toBeNull();
});

test('speech settings marks an ASR catalog failure as an error', async () => {
    const {api} = fakeSettingsApi();
    api.asrModels.list = vi.fn(async () => { throw new Error('catalog unavailable'); });
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    expect((await screen.findByRole('alert')).textContent).toContain('无法加载本地转写模型');
});

test('speech settings clears an old ASR action error before selecting an unavailable model', async () => {
    const failedSnapshot: AsrModelSnapshot = {
        ...asrModels,
        models: [
            asrModels.models[0],
            {...asrModels.models[1], installedState: 'failed', errorMessage: '模型下载失败'},
        ],
    };
    const {api} = fakeSettingsApi();
    api.asrModels.list = vi.fn(async () => failedSnapshot);
    api.asrModels.delete = vi.fn(async () => { throw new Error('无法删除当前模型'); });
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    fireEvent.click(await screen.findByRole('button', {name: '删除模型'}));
    expect(await screen.findByText('无法删除当前模型')).toBeTruthy();
    await chooseOption('识别模型', 'Streaming Zipformer (Chinese)');

    expect(screen.queryByText('无法删除当前模型')).toBeNull();
    expect(screen.getByText('模型下载失败')).toBeTruthy();
});

test('settings renders the Windows audio-source selector with system audio selected by default', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    const select = await screen.findByRole('combobox', {name: '音频来源'});
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('系统音频'));
    expect(select.id).toBe('asrAudioInputSelect');
    fireEvent.mouseDown(select);
    expect(screen.getAllByText('系统音频').length).toBeGreaterThan(0);
    expect(screen.getAllByText('麦克风').length).toBeGreaterThan(0);
    expect(screen.getAllByText('系统音频＋麦克风').length).toBeGreaterThan(0);
});

test('speech settings persists audio source through typed IPC', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);
    const select = await screen.findByRole('combobox', {name: '音频来源'}) as HTMLInputElement;
    await chooseOption('音频来源', '系统音频＋麦克风');
    await waitFor(() => expect(api.audioInput.set).toHaveBeenCalledWith('mixed'));
});

test('speech settings applies authoritative audio-source broadcasts', async () => {
    const {api, emitAudioInputChanged} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);
    await screen.findByRole('combobox', {name: '音频来源'});
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('系统音频'));

    act(() => emitAudioInputChanged('mixed'));

    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('系统音频＋麦克风'));
});

test('the last audio-source choice wins over older broadcasts and out-of-order save responses', async () => {
    let resolveMixed!: (mode: 'mixed') => void;
    let resolveMicrophone!: (mode: 'microphone') => void;
    const {api, emitAudioInputChanged} = fakeSettingsApi();
    api.audioInput.set = vi.fn((mode) => new Promise<'mixed' | 'microphone'>((resolve) => {
        if (mode === 'mixed') resolveMixed = resolve as (saved: 'mixed') => void;
        if (mode === 'microphone') resolveMicrophone = resolve as (saved: 'microphone') => void;
    }));
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    await screen.findByRole('combobox', {name: '音频来源'});
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('系统音频'));
    await chooseOption('音频来源', '系统音频＋麦克风');
    await chooseOption('音频来源', '麦克风');

    act(() => emitAudioInputChanged('mixed'));
    expect(selectedComboboxText('音频来源')).toContain('麦克风');

    act(() => resolveMicrophone('microphone'));
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('麦克风'));
    act(() => emitAudioInputChanged('mixed'));
    expect(selectedComboboxText('音频来源')).toContain('麦克风');
    act(() => resolveMixed('mixed'));
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('麦克风'));
});

test('speech settings applies authoritative ASR status broadcasts', async () => {
    const {api, emitAsrStatus} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);
    await screen.findByLabelText('识别模型');

    act(() => emitAsrStatus({
        currentModelId: 'streaming-paraformer-bilingual-zh-en',
        models: [{...asrModels.models[0], installedState: 'downloading', downloadedBytes: 113_000_000}],
    }));

    expect(screen.getByText('下载中 50%')).toBeTruthy();
});

test('settings ignores audio-source changes while the privacy platform is still resolving', async () => {
    let resolvePrivacyStatus!: (status: PrivacyStatus) => void;
    const delayedPrivacyStatus = new Promise<PrivacyStatus>((resolve) => { resolvePrivacyStatus = resolve; });
    const {api} = fakeSettingsApi();
    api.privacy.getStatus = vi.fn(() => delayedPrivacyStatus);
    window.meetingMonsterSettings = api;

    render(<SpeechSettingsPage active />);
    const select = await screen.findByRole('combobox', {name: '音频来源'}) as HTMLInputElement;
    expect(select.disabled).toBe(true);
    fireEvent.keyDown(select, {key: 'ArrowDown'});
    expect(api.audioInput.set).not.toHaveBeenCalled();

    act(() => resolvePrivacyStatus({...privacy, platform: 'darwin'}));
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('麦克风'));
});

test('settings ignores an early mixed broadcast until a non-Windows platform resolves', async () => {
    let resolvePrivacyStatus!: (status: PrivacyStatus) => void;
    const delayedPrivacyStatus = new Promise<PrivacyStatus>((resolve) => { resolvePrivacyStatus = resolve; });
    const {api, emitAudioInputChanged} = fakeSettingsApi();
    api.privacy.getStatus = vi.fn(() => delayedPrivacyStatus);
    window.meetingMonsterSettings = api;

    render(<SpeechSettingsPage active />);
    const select = await screen.findByRole('combobox', {name: '音频来源'}) as HTMLInputElement;
    act(() => emitAudioInputChanged('mixed'));
    expect(select.disabled).toBe(true);

    act(() => resolvePrivacyStatus({...privacy, platform: 'darwin'}));
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('麦克风'));
});

test('settings keeps microphone selected until platform and audio preference resolution complete', async () => {
    let resolvePrivacyStatus!: (status: PrivacyStatus) => void;
    let rejectAudioInput!: (reason?: unknown) => void;
    const delayedPrivacyStatus = new Promise<PrivacyStatus>((resolve) => { resolvePrivacyStatus = resolve; });
    const delayedAudioInput = new Promise<'system' | 'microphone' | 'mixed'>((_, reject) => { rejectAudioInput = reject; });
    const {api} = fakeSettingsApi();
    api.privacy.getStatus = vi.fn(() => delayedPrivacyStatus);
    api.audioInput.get = vi.fn(() => delayedAudioInput);
    window.meetingMonsterSettings = api;

    render(<SpeechSettingsPage active />);
    const select = await screen.findByRole('combobox', {name: '音频来源'}) as HTMLInputElement;
    expect(select.disabled).toBe(true);

    act(() => resolvePrivacyStatus(privacy));
    await Promise.resolve();
    expect(screen.getByText('正在检查音频来源支持情况。')).toBeTruthy();
    expect(select.disabled).toBe(true);

    act(() => rejectAudioInput(new Error('audio preference unavailable')));
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('系统音频＋麦克风'));
    expect(select.disabled).toBe(false);
});

test('settings falls back to microphone when the privacy platform cannot be loaded', async () => {
    const {api} = fakeSettingsApi();
    api.privacy.getStatus = vi.fn(async () => { throw new Error('privacy status unavailable'); });
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    const select = await screen.findByRole('combobox', {name: '音频来源'});
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('麦克风'));
    fireEvent.mouseDown(select);
    expect(screen.getByRole('option', {name: '系统音频'}).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('无法确定系统平台，当前使用麦克风。')).toBeTruthy();
});

test('settings normalizes macOS to microphone and disables unavailable audio sources', async () => {
    const {api} = fakeSettingsApi({...privacy, platform: 'darwin'});
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    const select = await screen.findByRole('combobox', {name: '音频来源'});
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('麦克风'));
    fireEvent.mouseDown(select);
    expect(screen.getByRole('option', {name: '系统音频'}).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('系统音频当前仅支持 Windows；当前使用麦克风。')).toBeTruthy();
});

test('settings keeps the prior audio source and reports a failed save', async () => {
    const {api} = fakeSettingsApi();
    api.audioInput.set = vi.fn(async () => { throw new Error('write failed'); });
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    await screen.findByRole('combobox', {name: '音频来源'});
    await waitFor(() => expect(selectedComboboxText('音频来源')).toContain('系统音频'));
    await chooseOption('音频来源', '系统音频＋麦克风');

    expect(await screen.findByText('无法保存音频来源')).toBeTruthy();
    expect(selectedComboboxText('音频来源')).toContain('系统音频');
});
