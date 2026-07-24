import {useEffect, useMemo, useState} from 'react';
import type {AsrModelId, AsrModelSnapshot, ModelOptions, ModelProfileId, SavedModelConnectionSettings, SelectableModelProfile} from '../../src/shared/contracts';
import {createAsrModelActions, describeAsrModel, formatAsrModelStatus} from '../shared/services/asr-model-service';
import {BUILT_IN_MODEL_PROFILES, buildModelSelection, createModelFormValues, findInitialProfile, getSavedModelConnection, loadModelSettings, saveModelConnection, testModelConnection, type ModelFormValues} from '../shared/services/model-settings-service';
import {AUDIO_INPUT_MODE_EVENT, readAudioInputMode, writeAudioInputMode, type AudioInputMode} from '../shared/services/audio-input-mode';

const defaultValues: ModelFormValues = {baseUrl: '', model: '', apiKey: '', maxTokens: '4096', temperature: '0.3'};

export function SettingsView({active}: {active: boolean}) {
    const api = window.meetingMonster;
    const [options, setOptions] = useState<ModelOptions>({active_profile: '', profiles: [...BUILT_IN_MODEL_PROFILES]});
    const [saved, setSaved] = useState<SavedModelConnectionSettings | null>(null);
    const [profile, setProfile] = useState<SelectableModelProfile>(BUILT_IN_MODEL_PROFILES[0]);
    const [formSnapshots, setFormSnapshots] = useState<Record<ModelProfileId, ModelFormValues>>({
        generic_openai: defaultValues,
        generic_anthropic: defaultValues,
    });
    const [remoteStatus, setRemoteStatus] = useState('');
    const [asrSnapshot, setAsrSnapshot] = useState<AsrModelSnapshot | null>(null);
    const [asrId, setAsrId] = useState<AsrModelId | null>(null);
    const [asrOperation, setAsrOperation] = useState<string | null>(null);
    const [audioInputMode, setAudioInputMode] = useState<AudioInputMode>('system');
    const [audioInputPlatform, setAudioInputPlatform] = useState<string | null>(null);

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
        }).catch(() => setRemoteStatus('模型配置加载失败'));
        void api.privacy.getStatus().then((status) => {
            if (!mounted) return;
            setAudioInputPlatform(status.platform);
            setAudioInputMode(readAudioInputMode(window.localStorage, status.platform));
        }).catch(() => {
            if (!mounted) return;
            setAudioInputPlatform('unknown');
            setAudioInputMode(readAudioInputMode(window.localStorage, 'unknown'));
        });
        void api.asrModels.list().then((next) => { if (mounted) { setAsrSnapshot(next); setAsrId(next.currentModelId); } }).catch(() => setAsrSnapshot(null));
        const unsubscribe = api.asrModels.onStatus((next) => setAsrSnapshot((current) => {
            setAsrId((selected) => selected ?? next.currentModelId);
            return next;
        }));
        return () => { mounted = false; unsubscribe(); };
    }, [api]);

    const profiles = BUILT_IN_MODEL_PROFILES;
    const profileId = profile.id as ModelProfileId;
    const values = formSnapshots[profileId] ?? defaultValues;
    const asrActions = useMemo(() => createAsrModelActions(api), [api]);
    const selectedAsr = asrSnapshot?.models.find((model) => model.id === (asrId ?? asrSnapshot.currentModelId));
    const asrStatus = formatAsrModelStatus(asrSnapshot, asrId, asrOperation);
    const isBusy = asrOperation !== null || selectedAsr?.installedState === 'downloading' || selectedAsr?.installedState === 'verifying';

    function selectProfile(id: string) {
        const next = profiles.find((item) => item.id === id);
        if (!next) return;
        setProfile(next);
        const nextId = next.id as ModelProfileId;
        setFormSnapshots((current) => ({...current, [nextId]: current[nextId] ?? createModelFormValues(next, saved)}));
        setRemoteStatus(`已选择：${next.label}`);
    }
    async function save() {
        try { setSaved(await saveModelConnection(api, profile, values)); setRemoteStatus('连接已保存到本机安全存储'); }
        catch (error) { setRemoteStatus(error instanceof Error ? `保存失败：${error.message}` : '保存失败'); }
    }
    async function test() {
        try { const result = await testModelConnection(api, profile, values); setRemoteStatus(result.ok ? `连接成功 · ${result.model} · ${result.latency_ms}ms` : '连接失败'); }
        catch (error) { setRemoteStatus(error instanceof Error ? `连接失败：${error.message}` : '连接失败'); }
    }
    function updateValue(field: keyof ModelFormValues, value: string) {
        setFormSnapshots((current) => ({...current, [profileId]: {...current[profileId], [field]: value}}));
    }
    async function selectAsr(id: AsrModelId) {
        setAsrId(id);
        const model = asrSnapshot?.models.find((item) => item.id === id);
        if (!model || model.installedState === 'not-downloaded' || model.installedState === 'failed') return;
        setAsrOperation('selecting');
        try { setAsrSnapshot(await asrActions.select(id)); } finally { setAsrOperation(null); }
    }
    async function download() {
        if (!asrId) return;
        setAsrOperation('downloading');
        try { setAsrSnapshot(await asrActions.download(asrId)); } catch (error) { setRemoteStatus(error instanceof Error ? error.message : '下载未完成，请重试'); }
        finally { setAsrOperation(null); }
    }
    async function cancel() { if (asrId) { await asrActions.cancel(asrId); setAsrSnapshot(await asrActions.refresh()); setAsrOperation(null); } }
    async function remove() { if (asrId) setAsrSnapshot(await asrActions.delete(asrId)); }
    function changeAudioInputMode(value: string) {
        if (audioInputPlatform === null || (value !== 'system' && value !== 'microphone' && value !== 'mixed')) return;
        const mode = writeAudioInputMode(window.localStorage, value, audioInputPlatform);
        setAudioInputMode(mode);
        window.dispatchEvent(new Event(AUDIO_INPUT_MODE_EVENT));
    }

    const isNonWindowsAudioInputPlatform = audioInputPlatform !== null && audioInputPlatform !== 'win32';
    const audioInputHint = audioInputPlatform === null
        ? '正在检查音频来源支持情况。'
        : audioInputPlatform === 'unknown'
            ? '无法确定系统平台，当前使用麦克风。'
            : isNonWindowsAudioInputPlatform
                ? '系统音频当前仅支持 Windows；当前使用麦克风。'
                : '系统音频用于识别电脑正在播放的会议声音。';

    return (
        <div className={`settings-content ${active ? '' : 'is-inactive'} no-drag`}>
            <section className="settings-scroll">
                <div className="settings-section">
                    <p className="section-kicker">REMOTE SERVICES</p>
                    <h2>连接与模型</h2>
                    <p className="settings-muted">内置模型随桌面端发布；在这里选择服务商、填写密钥，并保存当前连接。AI 回答仍由 Python 服务处理。</p>
                    <label className="field-label" htmlFor="modelProfileSelect">模型</label>
                    <select id="modelProfileSelect" aria-label="API 协议" className="settings-control" value={profile.id} onChange={(event) => selectProfile(event.target.value)}>
                        {profiles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                    <label className="field-label" htmlFor="modelBaseUrl">Base URL</label>
                    <input id="modelBaseUrl" className="settings-control" value={values.baseUrl} onChange={(event) => updateValue('baseUrl', event.target.value)} placeholder="https://api.example/v1" />
                    <label className="field-label" htmlFor="modelId">Model ID</label>
                    <input id="modelId" className="settings-control" value={values.model} onChange={(event) => updateValue('model', event.target.value)} placeholder="输入服务商的模型 ID" />
                    <label className="field-label" htmlFor="modelApiKey">API Key</label>
                    <input id="modelApiKey" className="settings-control" value={values.apiKey} onChange={(event) => updateValue('apiKey', event.target.value)} placeholder={getSavedModelConnection(saved, profileId)?.has_api_key ? '已安全保存，留空则沿用' : '可选，保存到本机安全存储'} type="password" />
                    <div className="field-grid">
                        <label><span className="field-label">最大 Token</span><input className="settings-control" value={values.maxTokens} onChange={(event) => updateValue('maxTokens', event.target.value)} /></label>
                        <label><span className="field-label">温度</span><input className="settings-control" value={values.temperature} onChange={(event) => updateValue('temperature', event.target.value)} /></label>
                    </div>
                    <div className="settings-actions"><button type="button" onClick={() => void save()}>保存连接</button><button type="button" className="primary" onClick={() => void test()}>测试连接</button></div>
                    <p className="settings-status">{remoteStatus || (getSavedModelConnection(saved, profileId) ? `已保存：${profile.label}` : `已选择：${profile.label}`)}</p>
                </div>
                <div className="settings-section">
                    <p className="section-kicker">LOCAL SPEECH RECOGNITION</p>
                    <h2>语音识别模型</h2>
                    <p className="settings-muted">选择本地语音识别模型后，下载完成即可开始转写。</p>
                    <label className="field-label" htmlFor="asrAudioInputSelect">音频来源</label>
                    <select id="asrAudioInputSelect" className="settings-control" value={audioInputMode} disabled={audioInputPlatform === null} onChange={(event) => changeAudioInputMode(event.target.value)}>
                        <option value="system" disabled={isNonWindowsAudioInputPlatform}>系统音频</option>
                        <option value="microphone">麦克风</option>
                        <option value="mixed" disabled={isNonWindowsAudioInputPlatform}>系统音频＋麦克风</option>
                    </select>
                    <p className="settings-muted">{audioInputHint}</p>
                    <label className="field-label" htmlFor="asrModelSelect">识别模型</label>
                    <select id="asrModelSelect" className="settings-control" value={asrId ?? ''} onChange={(event) => void selectAsr(event.target.value as AsrModelId)}>
                        {(asrSnapshot?.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                    </select>
                    {selectedAsr && <p id="asrModelDescription" className="settings-muted">{describeAsrModel(selectedAsr)}</p>}
                    <div className="asr-status" id="asrModelStatus">{asrStatus}</div>
                    {selectedAsr?.installedState === 'downloading' && <progress value={selectedAsr.downloadedBytes} max={selectedAsr.totalBytes} />}
                    <div className="settings-actions">
                        <button id="asrModelDownloadButton" type="button" className="primary" onClick={() => void download()} disabled={!selectedAsr || isBusy || selectedAsr.installedState === 'installed' || selectedAsr.installedState === 'ready'}>下载模型</button>
                        <button id="asrModelCancelButton" type="button" onClick={() => void cancel()} hidden={!isBusy}>取消下载</button>
                        <button id="asrModelDeleteButton" type="button" onClick={() => void remove()} disabled={!selectedAsr || isBusy} hidden={!selectedAsr || (selectedAsr.installedState !== 'installed' && selectedAsr.installedState !== 'ready')}>删除模型</button>
                    </div>
                </div>
            </section>
        </div>
    );
}
