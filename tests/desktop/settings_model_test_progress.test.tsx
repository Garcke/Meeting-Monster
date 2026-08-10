// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {ModelSettingsPage} from '../../desktop/ui/settings/ModelSettingsPage';
import type {ModelTestProgress, ModelTestResult, SavedModelConnectionSettings, SettingsRendererApi} from '../../desktop/src/shared/contracts';

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
    } as unknown as SettingsRendererApi;
    window.meetingMonsterSettings = api;
    render(<ModelSettingsPage active />);

    const testButton = await screen.findByRole('button', {name: '测试连接'});
    await waitFor(() => expect(api.models.onTestProgress).toHaveBeenCalledOnce());
    fireEvent.click(testButton);
    await act(async () => { emitProgress({phase: 'vision', attempt: 2, maxAttempts: 3}); });

    expect(screen.getByRole('button', {name: /验证图片 2\/3/}).getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', {name: '保存连接'}) as HTMLButtonElement).disabled).toBe(true);
});
