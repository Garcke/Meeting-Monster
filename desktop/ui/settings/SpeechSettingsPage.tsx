import {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Button, Progress, Select} from 'antd';
import type {AsrModelId, AsrModelSnapshot} from '../../src/shared/contracts';
import type {AudioInputMode} from '../../src/shared/audio-input-mode';
import {normalizeAudioInputMode} from '../../src/shared/audio-input-mode';
import {createAsrModelActions, describeAsrModel, formatAsrModelStatus} from '../shared/services/asr-model-service';

export function SpeechSettingsPage({active}: {active: boolean}) {
    const api = window.meetingMonsterSettings;
    const [platform, setPlatform] = useState<string | null>(null);
    const [platformResolved, setPlatformResolved] = useState(false);
    const [audioInputMode, setAudioInputMode] = useState<AudioInputMode>('microphone');
    const [audioInputError, setAudioInputError] = useState('');
    const resolvedPlatformRef = useRef<string | null>(null);
    const hasResolvedPlatform = useRef(false);
    const confirmedAudioInputMode = useRef<AudioInputMode>('microphone');
    const pendingAudioInputMode = useRef<AudioInputMode | null>(null);
    const audioInputRequestRevision = useRef(0);
    const audioInputRequestsInFlight = useRef(0);
    const [asrSnapshot, setAsrSnapshot] = useState<AsrModelSnapshot | null>(null);
    const [asrId, setAsrId] = useState<AsrModelId | null>(null);
    const [asrOperation, setAsrOperation] = useState<string | null>(null);
    const [asrError, setAsrError] = useState('');

    useEffect(() => {
        let mounted = true;
        let audioChanged = false;
        let asrChanged = false;
        const unsubscribeAudio = api.audioInput.onChanged((mode) => {
            if (!mounted || !hasResolvedPlatform.current || resolvedPlatformRef.current === null || (pendingAudioInputMode.current !== null && mode !== pendingAudioInputMode.current)) return;
            audioChanged = true;
            const normalized = normalizeAudioInputMode(mode, resolvedPlatformRef.current);
            confirmedAudioInputMode.current = normalized;
            setAudioInputMode(normalized);
        });
        const unsubscribeAsr = api.asrModels.onStatus((next) => {
            asrChanged = true;
            if (!mounted) return;
            setAsrSnapshot(next);
            setAsrId((selected) => selected ?? next.currentModelId);
            setAsrError('');
        });

        void Promise.allSettled([
            api.privacy.getStatus(),
            api.audioInput.get(),
            api.asrModels.list(),
        ]).then(([privacyResult, modeResult, snapshotResult]) => {
            if (!mounted) return;
            const resolvedPlatform = privacyResult.status === 'fulfilled' ? privacyResult.value.platform : null;
            const resolvedMode = resolvedPlatform
                ? normalizeAudioInputMode(modeResult.status === 'fulfilled' ? modeResult.value : undefined, resolvedPlatform)
                : 'microphone';
            resolvedPlatformRef.current = resolvedPlatform;
            hasResolvedPlatform.current = true;
            setPlatform(resolvedPlatform);
            setPlatformResolved(true);
            if (!audioChanged) {
                confirmedAudioInputMode.current = resolvedMode;
                setAudioInputMode(resolvedMode);
            }
            if (snapshotResult.status === 'fulfilled') {
                if (!asrChanged) setAsrSnapshot(snapshotResult.value);
                setAsrId((selected) => selected ?? snapshotResult.value.currentModelId);
            } else if (!asrChanged) {
                setAsrError('无法加载本地转写模型');
            }
        });

        return () => {
            mounted = false;
            unsubscribeAudio();
            unsubscribeAsr();
        };
    }, [api]);

    const asrActions = useMemo(() => createAsrModelActions(api), [api]);
    const selectedAsr = asrSnapshot?.models.find((model) => model.id === (asrId ?? asrSnapshot.currentModelId));
    const asrStatus = formatAsrModelStatus(asrSnapshot, asrId, asrOperation);
    const isBusy = asrOperation !== null || selectedAsr?.installedState === 'downloading' || selectedAsr?.installedState === 'verifying';
    const nonWindowsPlatform = platform !== 'win32';
    const audioInputHint = !platformResolved
        ? '正在检查音频来源支持情况。'
        : platform === null
            ? '无法确定系统平台，当前使用麦克风。'
            : nonWindowsPlatform
                ? '系统音频当前仅支持 Windows；当前使用麦克风。'
                : '系统音频用于识别电脑正在播放的会议声音。';

    async function changeAudioInputMode(value: string) {
        if (!platformResolved || platform === null || (value !== 'system' && value !== 'microphone' && value !== 'mixed')) return;
        const requestRevision = ++audioInputRequestRevision.current;
        audioInputRequestsInFlight.current += 1;
        pendingAudioInputMode.current = value;
        setAudioInputMode(value);
        setAudioInputError('');
        try {
            const normalized = await api.audioInput.set(value);
            if (requestRevision !== audioInputRequestRevision.current) return;
            pendingAudioInputMode.current = normalized;
            confirmedAudioInputMode.current = normalized;
            setAudioInputMode(normalized);
        } catch {
            if (requestRevision !== audioInputRequestRevision.current) return;
            pendingAudioInputMode.current = confirmedAudioInputMode.current;
            setAudioInputMode(confirmedAudioInputMode.current);
            setAudioInputError('无法保存音频来源');
        } finally {
            audioInputRequestsInFlight.current -= 1;
            if (audioInputRequestsInFlight.current === 0) pendingAudioInputMode.current = null;
        }
    }

    async function selectAsr(id: AsrModelId) {
        setAsrId(id);
        setAsrError('');
        const model = asrSnapshot?.models.find((item) => item.id === id);
        if (!model || model.installedState === 'not-downloaded' || model.installedState === 'failed') return;
        setAsrOperation('selecting');
        try {
            setAsrSnapshot(await asrActions.select(id));
        } catch (error) {
            setAsrError(error instanceof Error ? error.message : '无法切换本地转写模型');
        } finally {
            setAsrOperation(null);
        }
    }

    const asrStatusTone = asrError
        ? 'error'
        : selectedAsr?.installedState === 'installed' || selectedAsr?.installedState === 'ready'
            ? 'success'
            : 'neutral';

    async function download() {
        if (!asrId) return;
        setAsrOperation('downloading');
        setAsrError('');
        try {
            setAsrSnapshot(await asrActions.download(asrId));
        } catch (error) {
            setAsrError(error instanceof Error ? error.message : '下载未完成，请重试');
        } finally {
            setAsrOperation(null);
        }
    }

    async function cancel() {
        if (!asrId) return;
        setAsrError('');
        try {
            await asrActions.cancel(asrId);
            setAsrSnapshot(await asrActions.refresh());
        } catch (error) {
            setAsrError(error instanceof Error ? error.message : '无法取消下载');
        } finally {
            setAsrOperation(null);
        }
    }

    async function remove() {
        if (!asrId) return;
        setAsrError('');
        try {
            setAsrSnapshot(await asrActions.delete(asrId));
        } catch (error) {
            setAsrError(error instanceof Error ? error.message : '无法删除模型');
        }
    }

    return (
        <section className="settings-page" hidden={!active}>
            <header className="settings-page-header">
                <p className="settings-eyebrow">LOCAL SPEECH RECOGNITION</p>
                <h1>语音与转写</h1>
                <p>选择会议音频来源，并管理保存在本机的转写模型。</p>
            </header>
            <div className="settings-card">
                <div className="settings-card-heading">
                    <h2>音频来源</h2>
                    <span>{platform === 'win32' ? 'Windows' : '本机'}</span>
                </div>
                <div className="settings-field">
                    <label htmlFor="asrAudioInputSelect">音频来源</label>
                    <Select id="asrAudioInputSelect" aria-label="音频来源" value={audioInputMode} disabled={!platformResolved} onChange={(value) => void changeAudioInputMode(value)} options={[
                        {value: 'system', label: '系统音频', disabled: nonWindowsPlatform},
                        {value: 'microphone', label: '麦克风'},
                        {value: 'mixed', label: '系统音频＋麦克风', disabled: nonWindowsPlatform},
                    ]} />
                </div>
                <p className="settings-muted">{audioInputHint}</p>
                {audioInputError && <Alert className="settings-error" type="error" showIcon title={audioInputError} />}
            </div>
            <div className="settings-card">
                <div className="settings-card-heading">
                    <h2>本地转写模型</h2>
                    <span>离线</span>
                </div>
                <div className="settings-field">
                    <label htmlFor="asrModelSelect">识别模型</label>
                    <Select id="asrModelSelect" aria-label="识别模型" value={asrId ?? ''} onChange={(value) => void selectAsr(value as AsrModelId)} options={(asrSnapshot?.models ?? []).map((model) => ({value: model.id, label: model.label}))} />
                </div>
                {selectedAsr && <p id="asrModelDescription" className="settings-muted">{describeAsrModel(selectedAsr)}</p>}
                {asrError
                    ? <Alert className="settings-error" type="error" showIcon title={asrError} />
                    : <div className={`asr-status${asrStatusTone === 'neutral' ? '' : ` is-${asrStatusTone}`}`} id="asrModelStatus">{asrStatus}</div>}
                {selectedAsr?.installedState === 'downloading' && <Progress percent={selectedAsr.totalBytes ? Math.round((selectedAsr.downloadedBytes / selectedAsr.totalBytes) * 100) : 0} showInfo={false} size="small" />}
                <div className="settings-actions">
                    <Button id="asrModelDownloadButton" type="primary" loading={asrOperation === 'downloading'} onClick={() => void download()} disabled={!selectedAsr || isBusy || selectedAsr.installedState === 'installed' || selectedAsr.installedState === 'ready'}>下载模型</Button>
                    <Button id="asrModelCancelButton" onClick={() => void cancel()} hidden={!isBusy}>取消下载</Button>
                    <Button id="asrModelDeleteButton" onClick={() => void remove()} disabled={!selectedAsr || isBusy} hidden={!selectedAsr || (selectedAsr.installedState !== 'installed' && selectedAsr.installedState !== 'ready')}>删除模型</Button>
                </div>
            </div>
        </section>
    );
}
