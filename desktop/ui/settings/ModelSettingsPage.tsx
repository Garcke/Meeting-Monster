import {useEffect, useState} from 'react';
import type {ModelOptions, ModelProfileId, ModelTestProgress, SavedModelConnectionSettings, SelectableModelProfile} from '../../src/shared/contracts';
import {
    BUILT_IN_MODEL_PROFILES,
    createModelFormValues,
    findInitialProfile,
    getSavedModelConnection,
    loadModelSettings,
    saveModelConnection,
    testModelConnection,
    type ModelFormValues,
} from '../shared/services/model-settings-service';
import {formatModelConnectionError} from '../../src/main/remote-api-client';

const defaultValues: ModelFormValues = {baseUrl: '', model: '', apiKey: '', maxTokens: '4096', temperature: '0.3'};
const initialModelTestProgress: ModelTestProgress = {phase: 'connecting', attempt: 0, maxAttempts: 3};

export function ModelSettingsPage({active}: {active: boolean}) {
    const api = window.meetingMonsterSettings;
    const [options, setOptions] = useState<ModelOptions>({active_profile: '', profiles: [...BUILT_IN_MODEL_PROFILES]});
    const [saved, setSaved] = useState<SavedModelConnectionSettings | null>(null);
    const [profile, setProfile] = useState<SelectableModelProfile>(BUILT_IN_MODEL_PROFILES[0]);
    const [formSnapshots, setFormSnapshots] = useState<Record<ModelProfileId, ModelFormValues>>({
        generic_openai: defaultValues,
        generic_anthropic: defaultValues,
    });
    const [remoteStatus, setRemoteStatus] = useState('');
    const [modelAction, setModelAction] = useState<'idle' | 'testing' | 'saving'>('idle');
    const [modelTestProgress, setModelTestProgress] = useState<ModelTestProgress>(initialModelTestProgress);

    useEffect(() => {
        let mounted = true;
        void loadModelSettings(api).then((result) => {
            if (!mounted) return;
            setOptions(result.options);
            setSaved(result.saved);
            const nextProfile = findInitialProfile(result.options, result.saved);
            setProfile(nextProfile);
            setFormSnapshots({
                generic_openai: createModelFormValues(BUILT_IN_MODEL_PROFILES[0], result.saved),
                generic_anthropic: createModelFormValues(BUILT_IN_MODEL_PROFILES[1], result.saved),
            });
        }).catch(() => { if (mounted) setRemoteStatus('模型配置加载失败'); });
        return () => { mounted = false; };
    }, [api]);

    useEffect(() => {
        const unsubscribe = api.models.onTestProgress((progress) => setModelTestProgress(progress));
        return () => { unsubscribe(); };
    }, [api]);

    const profiles = options.profiles.length ? options.profiles : BUILT_IN_MODEL_PROFILES;
    const profileId = profile.id as ModelProfileId;
    const values = formSnapshots[profileId] ?? defaultValues;
    const modelActionsBusy = modelAction !== 'idle';

    function modelActionLabel(action: 'testing' | 'saving') {
        if (modelAction !== action) return action === 'testing' ? '测试连接' : '保存连接';
        return modelTestProgress.phase === 'vision'
            ? `验证图片 ${modelTestProgress.attempt}/${modelTestProgress.maxAttempts}`
            : '连接模型…';
    }

    function selectProfile(id: string) {
        const next = profiles.find((item) => item.id === id);
        if (!next) return;
        setProfile(next);
        const nextId = next.id as ModelProfileId;
        setFormSnapshots((current) => ({...current, [nextId]: current[nextId] ?? createModelFormValues(next, saved)}));
        setRemoteStatus(`已选择：${next.label}`);
    }

    async function save() {
        if (modelActionsBusy) return;
        setModelAction('saving');
        setModelTestProgress(initialModelTestProgress);
        try {
            setSaved(await saveModelConnection(api, profile, values));
            setRemoteStatus('多模态能力验证成功');
        } catch (error) {
            setRemoteStatus(formatModelConnectionError(error));
        } finally {
            setModelAction('idle');
            setModelTestProgress(initialModelTestProgress);
        }
    }

    async function test() {
        if (modelActionsBusy) return;
        setModelAction('testing');
        setModelTestProgress(initialModelTestProgress);
        try {
            const result = await testModelConnection(api, profile, values);
            setRemoteStatus(result.ok ? `多模态能力验证成功 · ${result.model} · ${result.latency_ms}ms` : '模型不支持图片输入或连接失败');
        } catch (error) {
            setRemoteStatus(formatModelConnectionError(error));
        } finally {
            setModelAction('idle');
            setModelTestProgress(initialModelTestProgress);
        }
    }

    function updateValue(field: keyof ModelFormValues, value: string) {
        setFormSnapshots((current) => ({...current, [profileId]: {...current[profileId], [field]: value}}));
    }

    return (
        <section className="settings-page" hidden={!active}>
            <header className="settings-page-header">
                <p className="settings-eyebrow">REMOTE SERVICES</p>
                <h1>AI 与模型</h1>
                <p>配置兼容的模型服务，并在保存前验证多模态能力。</p>
            </header>
            <div className="settings-card">
                <div className="settings-card-heading">
                    <h2>模型连接</h2>
                    <span>远程</span>
                </div>
                <div className="settings-field">
                    <label htmlFor="modelProtocol">模型</label>
                    <select id="modelProtocol" aria-label="API 协议" value={profile.id} onChange={(event) => selectProfile(event.target.value)}>
                        {profiles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                </div>
                <div className="settings-field">
                    <label htmlFor="modelBaseUrl">Base URL</label>
                    <input id="modelBaseUrl" aria-label="Base URL" value={values.baseUrl} onChange={(event) => updateValue('baseUrl', event.target.value)} placeholder="https://api.example/v1" />
                </div>
                <div className="settings-field">
                    <label htmlFor="modelId">Model ID</label>
                    <input id="modelId" aria-label="Model ID" value={values.model} onChange={(event) => updateValue('model', event.target.value)} placeholder="输入服务商的模型 ID" />
                </div>
                <div className="settings-field">
                    <label htmlFor="modelApiKey">API Key</label>
                    <input id="modelApiKey" aria-label="API Key" type="password" value={values.apiKey} onChange={(event) => updateValue('apiKey', event.target.value)} placeholder={getSavedModelConnection(saved, profileId)?.has_api_key ? '已安全保存，留空则沿用' : '可选，保存到本机安全存储'} />
                </div>
                <div className="settings-field-grid">
                    <div className="settings-field">
                        <label htmlFor="modelMaxTokens">最大 Token</label>
                        <input id="modelMaxTokens" aria-label="最大 Token" value={values.maxTokens} onChange={(event) => updateValue('maxTokens', event.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="modelTemperature">温度</label>
                        <input id="modelTemperature" aria-label="温度" value={values.temperature} onChange={(event) => updateValue('temperature', event.target.value)} />
                    </div>
                </div>
                <div className="settings-actions">
                    <button type="button" className={modelAction === 'saving' ? 'is-busy' : ''} disabled={modelActionsBusy} aria-busy={modelAction === 'saving' || undefined} onClick={() => void save()}>
                        {modelAction === 'saving' && <span className="model-action-spinner" aria-hidden="true" />}{modelActionLabel('saving')}
                    </button>
                    <button type="button" className={`primary${modelAction === 'testing' ? ' is-busy' : ''}`} disabled={modelActionsBusy} aria-busy={modelAction === 'testing' || undefined} onClick={() => void test()}>
                        {modelAction === 'testing' && <span className="model-action-spinner" aria-hidden="true" />}{modelActionLabel('testing')}
                    </button>
                </div>
                <p className="settings-status" aria-live="polite">{remoteStatus || (getSavedModelConnection(saved, profileId) ? `已保存：${profile.label}` : `已选择：${profile.label}`)}</p>
            </div>
        </section>
    );
}
