import {FormEvent, useEffect, useRef, useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {AsrStatus, ChatStreamEvent} from '../../src/shared/contracts';
import {isAsrModelReady} from '../shared/services/asr-model-service';
import {
    AUDIO_INPUT_MODE_EVENT,
    readAudioInputMode,
    type AudioInputMode,
    type AudioInputPlatform,
} from '../shared/services/audio-input-mode';
import {canStartRecording, canStopRecording, PcmAudioRecorder, type RecordingPhase} from '../shared/services/audio-recorder';
import {stripAssistantThinking} from '../shared/services/assistant-markdown';
import {findInitialProfile, loadModelSettings} from '../shared/services/model-settings-service';
import {QuestionStore} from '../shared/services/question-store';

function isPermissionDenied(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error
        && error.name === 'NotAllowedError';
}

function formatAudioCaptureError(mode: AudioInputMode, error: unknown): string {
    if (mode === 'system' && isPermissionDenied(error)) {
        return '系统音频权限被拒绝，请检查 Windows 声音权限后重试';
    }
    if (mode === 'microphone' && isPermissionDenied(error)) {
        return '麦克风权限被拒绝，请在系统设置中允许 Meeting-Monster 使用麦克风';
    }
    if (mode === 'system') {
        return '系统音频不可用，请检查 Windows 声音权限后重试';
    }
    if (mode === 'mixed') {
        return '系统音频与麦克风均不可用，请检查权限后重试';
    }
    return '麦克风不可用，请检查系统权限后重试';
}

function formatInputEndedError(mode: AudioInputMode, error: Error): string {
    if (error.message.includes('系统音频') || mode === 'system') {
        return '系统音频输入已结束，请重新开始转写';
    }
    if (error.message.includes('麦克风') || mode === 'microphone') {
        return '麦克风输入已结束，请重新开始转写';
    }
    return '音频输入已结束，请重新开始转写';
}

export function WorkspaceView({active}: {active: boolean}) {
    const api = window.meetingMonster;
    const storeRef = useRef(new QuestionStore());
    const recorderRef = useRef<PcmAudioRecorder | null>(null);
    const recordingPhaseRef = useRef<RecordingPhase>('idle');
    const platformRef = useRef<AudioInputPlatform | null>(null);
    const [questions, setQuestions] = useState(storeRef.current.getQuestions());
    const [partial, setPartial] = useState('');
    const [answer, setAnswer] = useState('');
    const [input, setInput] = useState('');
    const [asr, setAsr] = useState<AsrStatus>({state: 'idle'});
    const [asrReady, setAsrReady] = useState(false);
    const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>('idle');
    const [platform, setPlatform] = useState<AudioInputPlatform | null>(null);
    const [audioInputMode, setAudioInputMode] = useState<AudioInputMode>('microphone');
    const [audioError, setAudioError] = useState<string | null>(null);
    const [remoteModelLabel, setRemoteModelLabel] = useState('通用 OpenAI Compatible');
    const [chatBusy, setChatBusy] = useState(false);
    const [action, setAction] = useState<'assist' | 'followup' | 'recap'>('assist');
    const activeRequest = useRef<{id: string; questionId: string} | null>(null);

    const refresh = () => setQuestions([...storeRef.current.getQuestions()]);
    const updateRecordingPhase = (phase: RecordingPhase) => {
        recordingPhaseRef.current = phase;
        setRecordingPhase(phase);
    };

    useEffect(() => {
        const unsubscribeStatus = api.asr.onStatus(setAsr);
        const unsubscribeResult = api.asr.onResult((event) => {
            if (event.type === 'partial') setPartial(event.text);
            if (event.type === 'final') {
                const question = storeRef.current.addQuestion(event.text, 'asr');
                setPartial('');
                refresh();
                if (question) void ask();
            }
            if (event.type === 'error') setAsr({state: 'error', message: event.text});
        });
        const unsubscribeChat = api.chat.onEvent(handleChatEvent);
        const unsubscribeModels = api.asrModels.onStatus((next) => setAsrReady(isAsrModelReady(next, next.currentModelId)));
        void api.asrModels.list().then((next) => setAsrReady(isAsrModelReady(next, next.currentModelId))).catch(() => setAsrReady(false));
        void loadModelSettings(api).then(({options, saved}) => {
            setRemoteModelLabel(findInitialProfile(options, saved).label);
        });
        return () => {
            unsubscribeStatus();
            unsubscribeResult();
            unsubscribeChat();
            unsubscribeModels();
            const holder = recorderRef.current;
            recorderRef.current = null;
            recordingPhaseRef.current = 'idle';
            if (holder) {
                void holder.stop().catch(() => undefined);
                void api.asr.stop().catch(() => undefined);
            }
        };
    }, [api]);

    useEffect(() => {
        let disposed = false;
        const updateAudioInputMode = () => {
            const currentPlatform = platformRef.current;
            if (currentPlatform === null) return;
            setAudioInputMode(readAudioInputMode(window.localStorage, currentPlatform));
        };

        window.addEventListener(AUDIO_INPUT_MODE_EVENT, updateAudioInputMode);
        void api.privacy.getStatus().then((status) => {
            if (disposed) return;
            platformRef.current = status.platform;
            setPlatform(status.platform);
            setAudioInputMode(readAudioInputMode(window.localStorage, status.platform));
        }).catch(() => undefined);

        return () => {
            disposed = true;
            window.removeEventListener(AUDIO_INPUT_MODE_EVENT, updateAudioInputMode);
        };
    }, [api]);

    async function handleInputEnded(holder: PcmAudioRecorder, mode: AudioInputMode, error: Error) {
        if (recorderRef.current !== holder) return;
        if (recordingPhaseRef.current === 'idle' || recordingPhaseRef.current === 'stopping') return;
        const message = formatInputEndedError(mode, error);
        updateRecordingPhase('stopping');
        recorderRef.current = null;
        setAudioError(message);
        setAsr({state: 'error', message});
        await holder.stop().catch(() => undefined);
        await api.asr.stop().catch(() => undefined);
        updateRecordingPhase('idle');
        setAsr({state: 'error', message});
    }

    async function startRecording() {
        if (!canStartRecording(asrReady, recordingPhaseRef.current)) return;
        if (platform === null) {
            const message = '音频来源尚未准备，请稍后重试';
            setAudioError(message);
            setAsr({state: 'error', message});
            return;
        }

        const mode = readAudioInputMode(window.localStorage, platform);
        setAudioInputMode(mode);
        setAudioError(null);
        updateRecordingPhase('connecting');
        setAsr({state: 'connecting'});
        let holder!: PcmAudioRecorder;
        holder = new PcmAudioRecorder({
            inputMode: mode,
            onPcm: (chunk) => api.asr.writePcm(chunk),
            onInputEnded: (error) => void handleInputEnded(holder, mode, error),
        });
        recorderRef.current = holder;
        try {
            const sampleRate = await holder.prepare();
            if (recorderRef.current !== holder || recordingPhaseRef.current !== 'connecting') return;
            await api.asr.start(sampleRate);
            if (recorderRef.current !== holder || recordingPhaseRef.current !== 'connecting') return;
            holder.start();
            updateRecordingPhase('recording');
        } catch (error) {
            if (recorderRef.current !== holder) return;
            recorderRef.current = null;
            await holder.stop().catch(() => undefined);
            await api.asr.stop().catch(() => undefined);
            const message = formatAudioCaptureError(mode, error);
            updateRecordingPhase('idle');
            setAudioError(message);
            setAsr({state: 'error', message});
        }
    }

    async function stopRecording() {
        if (!canStopRecording(recordingPhaseRef.current)) return;
        const holder = recorderRef.current;
        recorderRef.current = null;
        updateRecordingPhase('stopping');
        setAsr({state: 'stopping'});
        await holder?.stop().catch(() => undefined);
        await api.asr.stop().catch(() => undefined);
        updateRecordingPhase('idle');
        setAudioError(null);
        setAsr({state: 'idle'});
    }

    function cancelActiveRequest() {
        const request = activeRequest.current;
        if (!request) return;
        activeRequest.current = null;
        setChatBusy(false);
        void api.chat.cancel(request.id).catch(() => undefined);
    }

    async function ask(requestedAction = action) {
        const selectedQuestions = storeRef.current.getSelectedQuestions();
        const question = selectedQuestions[selectedQuestions.length - 1];
        if (!question) return;
        if (activeRequest.current) await api.chat.cancel(activeRequest.current.id).catch(() => undefined);
        storeRef.current.resetAnswer(question.id);
        storeRef.current.setAnswerStatus(question.id, 'loading');
        refresh();
        const requestId = crypto.randomUUID();
        activeRequest.current = {id: requestId, questionId: question.id};
        setAnswer('');
        setChatBusy(true);
        const selectedText = selectedQuestions.map((item) => item.text).join('\n');
        const prompt = requestedAction === 'followup'
            ? `请基于以下面试内容给出一个有深度且自然的追问：\n${selectedText}`
            : requestedAction === 'recap'
                ? `请简洁重述以下面试内容，并提炼回答重点：\n${selectedText}`
                : selectedText;
        try { await api.chat.send(requestId, prompt); } catch (error) {
            if (activeRequest.current?.id === requestId) {
                storeRef.current.setAnswerStatus(question.id, 'error', error instanceof Error ? error.message : '回答失败');
                activeRequest.current = null;
                setChatBusy(false);
                refresh();
            }
        }
    }

    function handleChatEvent(event: ChatStreamEvent) {
        const request = activeRequest.current;
        if (!request || request.id !== event.requestId) return;
        if (event.type === 'chunk') {
            const text = event.text || '';
            setAnswer((current) => current + text);
            storeRef.current.appendAnswer(request.questionId, text);
            refresh();
        } else if (event.type === 'done') {
            storeRef.current.setAnswerStatus(request.questionId, 'complete');
            activeRequest.current = null;
            setChatBusy(false);
            refresh();
        } else {
            storeRef.current.setAnswerStatus(request.questionId, 'error', event.text || '回答失败');
            activeRequest.current = null;
            setChatBusy(false);
            refresh();
        }
    }

    function submit(event: FormEvent) {
        event.preventDefault();
        const text = input.trim();
        if (!text) { if (storeRef.current.getSelectedQuestions().length > 0) void ask('assist'); return; }
        const question = storeRef.current.addQuestion(text, 'manual');
        setInput('');
        setAnswer('');
        refresh();
        if (question) void ask('assist');
    }

    const selectedQuestions = storeRef.current.getSelectedQuestions();
    const selectedIds = new Set(storeRef.current.getSelectedIds());
    const current = selectedQuestions[selectedQuestions.length - 1] ?? null;
    const displayedAnswer = answer || current?.answer || '';
    const visibleAnswer = stripAssistantThinking(displayedAnswer);
    const fallbackAnswer = current ? '选择 Assist 生成回答' : '选择一个问题后，点击 Assist 生成回答';
    return (
            <div
                className={`workspace-content ${active ? '' : 'is-inactive'}`}
                data-audio-input-mode={audioInputMode}
            >
            <div className="workspace-transcript no-drag">
                {questions.length === 0 && !partial && <p className="empty-copy">开始转写后，当前问题会显示在这里</p>}
                {questions.map((question) => (
                    <button key={question.id} className={`question-row ${selectedIds.has(question.id) ? 'is-selected' : ''}`} type="button" aria-pressed={selectedIds.has(question.id)} onClick={() => { cancelActiveRequest(); storeRef.current.toggleQuestion(question.id); setAnswer(''); refresh(); }}>
                        {question.text}
                    </button>
                ))}
                {partial && <p className="partial-row">{partial}</p>}
            </div>
            <div className="workspace-answer no-drag">
                <div className="answer-heading"><span>AI REPLY</span><em>{chatBusy ? '等待生成' : current?.answerStatus === 'error' ? '失败' : `当前：${remoteModelLabel}`}</em></div>
                <div className="answer-scroll no-drag">
                    {visibleAnswer ? (
                        <div className="answer-markdown">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                                {visibleAnswer}
                            </ReactMarkdown>
                        </div>
                    ) : (
                        <p>{fallbackAnswer}</p>
                    )}
                </div>
            </div>
            <form className="workspace-composer no-drag" onSubmit={submit}>
                <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入问题后发送" aria-label="输入问题" />
                {audioError && <p className="audio-error" role="alert">{audioError}</p>}
                <div className="composer-actions">
                    <button type="button" className="record-action is-recording" onClick={() => void startRecording()} disabled={!canStartRecording(asrReady, recordingPhase)}>● 开始转写</button>
                    <button type="button" className="record-action" onClick={() => void stopRecording()} disabled={!canStopRecording(recordingPhase)}>停止</button>
                    <button type="button" className="record-action" onClick={() => { cancelActiveRequest(); void stopRecording(); storeRef.current.clear(); setPartial(''); setAnswer(''); refresh(); }}>清空</button>
                    <span className="composer-divider" aria-hidden="true" />
                    <button className={action === 'assist' ? 'composer-ai-action is-active' : 'composer-ai-action'} type="button" disabled={selectedQuestions.length === 0 || chatBusy} onClick={() => { setAction('assist'); void ask('assist'); }}>✦ Assist</button>
                    <button className={action === 'followup' ? 'composer-ai-action is-active' : 'composer-ai-action'} type="button" disabled={selectedQuestions.length === 0 || chatBusy} onClick={() => { setAction('followup'); void ask('followup'); }}>↗ 追问</button>
                    <button className={action === 'recap' ? 'composer-ai-action is-active' : 'composer-ai-action'} type="button" disabled={selectedQuestions.length === 0 || chatBusy} onClick={() => { setAction('recap'); void ask('recap'); }}>↻ 重述</button>
                    <span className="question-count">{selectedQuestions.length}/{questions.length} 段</span>
                    <span className="composer-hint">Ctrl + Enter</span>
                    <button className="send-button" type="submit" aria-label="发送">➜</button>
                </div>
            </form>
        </div>
    );
}
