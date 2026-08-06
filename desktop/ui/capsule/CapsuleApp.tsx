import {useEffect, useState} from 'react';
import type {AsrStatus, OverlaySnapshot} from '../../src/shared/contracts';
import logoUrl from '../../renderer/favicon.png';
import './capsule.css';

const initialSnapshot: OverlaySnapshot = {target: 'closed', phase: 'hidden', revision: 0};

export function CapsuleApp() {
    const [snapshot, setSnapshot] = useState<OverlaySnapshot>(initialSnapshot);
    const [asr, setAsr] = useState<AsrStatus>({state: 'idle'});

    useEffect(() => {
        const api = window.meetingMonster;
        const unsubscribeOverlay = api.overlay.onSnapshot(setSnapshot);
        const unsubscribeAsr = api.asr.onStatus(setAsr);
        void api.overlay.getSnapshot().then(setSnapshot).catch(() => undefined);
        void api.asr.getStatus().then(setAsr).catch(() => undefined);
        return () => {
            unsubscribeOverlay();
            unsubscribeAsr();
        };
    }, []);

    const sendIntent = async () => {
        try {
            setSnapshot(await window.meetingMonster.overlay.intent({type: 'toggle-workspace'}));
        } catch {
            // The next main-process snapshot remains authoritative.
        }
    };

    const isRecording = asr.state === 'recording';
    const statusLabel = asr.state === 'error'
        ? 'Local ASR fail'
        : isRecording ? '正在实时转写' : '就绪';

    return (
        <main className="capsule-shell" aria-label="Meeting-Monster 悬浮胶囊">
            <div className="capsule-grip">
                <span className={`capsule-avatar ${isRecording ? 'is-recording' : ''}`} aria-hidden="true">
                    <img className="capsule-avatar-image" src={logoUrl} alt="" />
                </span>
                <span className={`capsule-dot ${isRecording ? 'is-recording' : ''}`} aria-hidden="true" />
                <span className="capsule-status">{statusLabel}</span>
            </div>
            <button className="capsule-button" type="button" aria-expanded={snapshot.target === 'workspace'} onClick={() => void sendIntent()}>
                {snapshot.target === 'workspace' ? '收起' : 'Chat'} <span aria-hidden="true">⌄</span>
            </button>
            <button className="capsule-stop" type="button" aria-label="退出应用" title="退出应用" onClick={() => void window.meetingMonster.window.quit().catch(() => undefined)}>
                <span aria-hidden="true">■</span>
            </button>
        </main>
    );
}
