// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {SettingsApp} from '../../desktop/ui/settings/SettingsApp';
import {ModelSettingsPage} from '../../desktop/ui/settings/ModelSettingsPage';
import {SpeechSettingsPage} from '../../desktop/ui/settings/SpeechSettingsPage';
import type {AsrModelSnapshot, PrivacyStatus, SavedModelConnectionSettings, SettingsRendererApi} from '../../desktop/src/shared/contracts';

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

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'meetingMonsterSettings');
});

test('settings shell switches pages, exposes the app version, and closes through IPC', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<SettingsApp />);

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
    fireEvent.change(screen.getByLabelText('API 协议'), {target: {value: 'generic_anthropic'}});
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

    const diagnostic = await screen.findByText('认证失败（HTTP 401）：请检查 API Key 或账号区域');
    expect(diagnostic.classList.contains('is-error')).toBe(true);
    expect(screen.queryByText('provider body must never be displayed')).toBeNull();
});

test('speech settings marks an ASR catalog failure as an error', async () => {
    const {api} = fakeSettingsApi();
    api.asrModels.list = vi.fn(async () => { throw new Error('catalog unavailable'); });
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    const error = await screen.findByText('无法加载本地转写模型');
    expect(error.classList.contains('is-error')).toBe(true);
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
    fireEvent.change(screen.getByLabelText('识别模型'), {target: {value: 'streaming-zipformer-zh-int8-2025-06-30'}});

    expect(screen.queryByText('无法删除当前模型')).toBeNull();
    expect(screen.getByText('模型下载失败')).toBeTruthy();
});

test('settings renders the Windows audio-source selector with system audio selected by default', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('system'));
    expect(select.id).toBe('asrAudioInputSelect');
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['系统音频', '麦克风', '系统音频＋麦克风']);
});

test('speech settings persists audio source through typed IPC', async () => {
    const {api} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);
    const select = await screen.findByLabelText('音频来源');
    fireEvent.change(select, {target: {value: 'mixed'}});
    await waitFor(() => expect(api.audioInput.set).toHaveBeenCalledWith('mixed'));
});

test('speech settings applies authoritative audio-source broadcasts', async () => {
    const {api, emitAudioInputChanged} = fakeSettingsApi();
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);
    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('system'));

    act(() => emitAudioInputChanged('mixed'));

    expect(select.value).toBe('mixed');
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

    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('system'));
    fireEvent.change(select, {target: {value: 'mixed'}});
    fireEvent.change(select, {target: {value: 'microphone'}});

    act(() => emitAudioInputChanged('mixed'));
    expect(select.value).toBe('microphone');

    act(() => resolveMicrophone('microphone'));
    await waitFor(() => expect(select.value).toBe('microphone'));
    act(() => emitAudioInputChanged('mixed'));
    expect(select.value).toBe('microphone');
    act(() => resolveMixed('mixed'));
    await waitFor(() => expect(select.value).toBe('microphone'));
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
    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    fireEvent.change(select, {target: {value: 'mixed'}});
    expect(api.audioInput.set).not.toHaveBeenCalled();

    act(() => resolvePrivacyStatus({...privacy, platform: 'darwin'}));
    await waitFor(() => expect(select.value).toBe('microphone'));
});

test('settings falls back to microphone when the privacy platform cannot be loaded', async () => {
    const {api} = fakeSettingsApi();
    api.privacy.getStatus = vi.fn(async () => { throw new Error('privacy status unavailable'); });
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('microphone'));
    expect(select.options[0]?.disabled).toBe(true);
    expect(select.options[2]?.disabled).toBe(true);
    expect(screen.getByText('无法确定系统平台，当前使用麦克风。')).toBeTruthy();
});

test('settings normalizes macOS to microphone and disables unavailable audio sources', async () => {
    const {api} = fakeSettingsApi({...privacy, platform: 'darwin'});
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('microphone'));
    expect(select.options[0]?.disabled).toBe(true);
    expect(select.options[2]?.disabled).toBe(true);
    expect(screen.getByText('系统音频当前仅支持 Windows；当前使用麦克风。')).toBeTruthy();
});

test('settings keeps the prior audio source and reports a failed save', async () => {
    const {api} = fakeSettingsApi();
    api.audioInput.set = vi.fn(async () => { throw new Error('write failed'); });
    window.meetingMonsterSettings = api;
    render(<SpeechSettingsPage active />);

    const select = await screen.findByLabelText('音频来源') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('system'));
    fireEvent.change(select, {target: {value: 'mixed'}});

    expect(await screen.findByText('无法保存音频来源')).toBeTruthy();
    expect(select.value).toBe('system');
});
