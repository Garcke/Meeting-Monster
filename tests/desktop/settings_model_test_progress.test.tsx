// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {SettingsView} from '../../desktop/ui/panel/SettingsView';
import type {AsrModelSnapshot, MeetingMonsterApi, ModelTestProgress, ModelTestResult, PrivacyStatus, SavedModelConnectionSettings} from '../../desktop/src/shared/contracts';

const privacy: PrivacyStatus = {captureProtection: 'protected', captureProtectionEnabled: true, platform: 'win32', windowCount: 1};
const asrSnapshot: AsrModelSnapshot = {
    currentModelId: 'streaming-paraformer-bilingual-zh-en',
    models: [{
        id: 'streaming-paraformer-bilingual-zh-en', label: 'Streaming Paraformer', languages: ['zh', 'en'], description: 'Paraformer',
        estimatedBytes: 226_000_000, supportsHotwords: false, installedState: 'installed', isCurrent: true,
        downloadedBytes: 226_000_000, totalBytes: 226_000_000,
    }],
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

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

test('shows the active model test progress and blocks saving while the test runs', async () => {
    let emitProgress!: (progress: ModelTestProgress) => void;
    const testConnection = vi.fn(() => new Promise<ModelTestResult>(() => {}));
    const api = {
        privacy: {getStatus: vi.fn(async () => privacy)},
        asrModels: {list: vi.fn(async () => asrSnapshot), onStatus: vi.fn(() => () => {})},
        models: {
            list: vi.fn(async () => ({active_profile: 'generic_openai', profiles: []})),
            getSaved: vi.fn(async () => saved),
            save: vi.fn(),
            test: testConnection,
            onTestProgress: vi.fn((listener: (progress: ModelTestProgress) => void) => {
                emitProgress = listener;
                return () => {};
            }),
        },
    } as unknown as MeetingMonsterApi;
    window.meetingMonster = api;
    render(<SettingsView active />);

    const testButton = await screen.findByRole('button', {name: '测试连接'});
    await waitFor(() => expect(api.models.onTestProgress).toHaveBeenCalledOnce());
    fireEvent.click(testButton);
    await act(async () => { emitProgress({phase: 'vision', attempt: 2, maxAttempts: 3}); });

    expect(screen.getByRole('button', {name: '验证图片 2/3'}).getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', {name: '保存连接'}) as HTMLButtonElement).disabled).toBe(true);
});
