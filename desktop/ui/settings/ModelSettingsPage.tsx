import {useEffect, useRef, useState} from 'react';
import {Alert, Button, Input, InputNumber, Progress, Select, Spin} from 'antd';
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
import {formatModelConnectionError} from '../../src/shared/model-connection-diagnostics';

const defaultValues: ModelFormValues = {baseUrl: '', model: '', apiKey: '', maxTokens: '4096', temperature: '0.3'};
const initialModelTestProgress: ModelTestProgress = {phase: 'connecting', attempt: 0, maxAttempts: 3};
type ModelStatusTone = 'neutral' | 'success' | 'error';

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
    const [remoteStatusTone, setRemoteStatusTone] = useState<ModelStatusTone>('neutral');
    const [modelAction, setModelAction] = useState<'idle' | 'testing' | 'saving'>('idle');
    const [modelTestProgress, setModelTestProgress] = useState<ModelTestProgress>(initialModelTestProgress);
    const touchedProfiles = useRef<Record<ModelProfileId, boolean>>({generic_openai: false, generic_anthropic: false});

    useEffect(() => {
        let mounted = true;
        void loadModelSettings(api).then((result) => {
            if (!mounted) return;
            setOptions(result.options);
            setSaved(result.saved);
            const nextProfile = findInitialProfile(result.options, result.saved);
            setProfile(nextProfile);
            const hydratedSnapshots = {
                generic_openai: createModelFormValues(BUILT_IN_MODEL_PROFILES[0], result.saved),
                generic_anthropic: createModelFormValues(BUILT_IN_MODEL_PROFILES[1], result.saved),
            };
            setFormSnapshots((current) => ({
                generic_openai: touchedProfiles.current.generic_openai ? current.generic_openai : hydratedSnapshots.generic_openai,
                generic_anthropic: touchedProfiles.current.generic_anthropic ? current.generic_anthropic : hydratedSnapshots.generic_anthropic,
            }));
        }).catch(() => {
            if (!mounted) return;
            setRemoteStatus('模型配置加载失败');
            setRemoteStatusTone('error');
        });
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
        setRemoteStatusTone('neutral');
    }

    async function save() {
        if (modelActionsBusy) return;
        setModelAction('saving');
        setModelTestProgress(initialModelTestProgress);
        try {
            setSaved(await saveModelConnection(api, profile, values));
            setRemoteStatus('多模态能力验证成功');
            setRemoteStatusTone('success');
        } catch (error) {
            setRemoteStatus(formatModelConnectionError(error));
            setRemoteStatusTone('error');
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
            setRemoteStatusTone(result.ok ? 'success' : 'error');
        } catch (error) {
            setRemoteStatus(formatModelConnectionError(error));
            setRemoteStatusTone('error');
        } finally {
            setModelAction('idle');
            setModelTestProgress(initialModelTestProgress);
        }
    }

    function updateValue(field: keyof ModelFormValues, value: string) {
        touchedProfiles.current[profileId] = true;
        setFormSnapshots((current) => ({...current, [profileId]: {...current[profileId], [field]: value}}));
    }

    const displayedStatus = remoteStatus || (getSavedModelConnection(saved, profileId) ? `已保存：${profile.label}` : `已选择：${profile.label}`);
    const displayedStatusTone: ModelStatusTone = remoteStatus ? remoteStatusTone : getSavedModelConnection(saved, profileId) ? 'success' : 'neutral';

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
                    <Select id="modelProtocol" aria-label="API 协议" value={profile.id} onChange={selectProfile} options={profiles.map((item) => ({value: item.id, label: item.label}))} />
                </div>
                <div className="settings-field">
                    <label htmlFor="modelBaseUrl">Base URL</label>
                    <Input id="modelBaseUrl" aria-label="Base URL" value={values.baseUrl} onChange={(event) => updateValue('baseUrl', event.target.value)} placeholder="https://api.example/v1" />
                </div>
                <div className="settings-field">
                    <label htmlFor="modelId">Model ID</label>
                    <Input id="modelId" aria-label="Model ID" value={values.model} onChange={(event) => updateValue('model', event.target.value)} placeholder="输入服务商的模型 ID" />
                </div>
                <div className="settings-field">
                    <label htmlFor="modelApiKey">API Key</label>
                    <Input.Password id="modelApiKey" aria-label="API Key" value={values.apiKey} onChange={(event) => updateValue('apiKey', event.target.value)} placeholder={getSavedModelConnection(saved, profileId)?.has_api_key ? '已安全保存，留空则沿用' : '可选，保存到本机安全存储'} />
                </div>
                <div className="settings-field-grid">
                    <div className="settings-field">
                        <label htmlFor="modelMaxTokens">最大 Token</label>
                        <InputNumber id="modelMaxTokens" aria-label="最大 Token" value={Number(values.maxTokens)} min={1} onChange={(value) => updateValue('maxTokens', value === null ? '' : String(value))} />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="modelTemperature">温度</label>
                        <InputNumber id="modelTemperature" aria-label="温度" value={Number(values.temperature)} min={0} max={2} step={0.1} onChange={(value) => updateValue('temperature', value === null ? '' : String(value))} />
                    </div>
                </div>
                <div className="settings-actions">
                    <Button loading={modelAction === 'saving'} disabled={modelActionsBusy} aria-busy={modelAction === 'saving' || undefined} onClick={() => void save()}>{modelActionLabel('saving')}</Button>
                    <Button type="primary" loading={modelAction === 'testing'} disabled={modelActionsBusy} aria-busy={modelAction === 'testing' || undefined} onClick={() => void test()}>{modelActionLabel('testing')}</Button>
                </div>
                {modelAction === 'testing' && <Progress percent={modelTestProgress.maxAttempts ? Math.round((modelTestProgress.attempt / modelTestProgress.maxAttempts) * 100) : 0} showInfo={false} size="small" />}
                <div className="settings-status" aria-live="polite">
                    {displayedStatusTone === 'error'
                        ? <Alert type="error" showIcon title={displayedStatus} />
                        : <span className={displayedStatusTone === 'success' ? 'is-success' : undefined}>{modelActionsBusy ? <Spin size="small" /> : null}{displayedStatus}</span>}
                </div>
            </div>
        </section>
    );
}
