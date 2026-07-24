import {useEffect, useState} from 'react';
import type {AsrStatus, OverlaySnapshot, PrivacyStatus} from '../../src/shared/contracts';
import logoUrl from '../../renderer/favicon.png';
import './capsule.css';

const initialSnapshot: OverlaySnapshot = {target: 'closed', phase: 'hidden', revision: 0};

export function CapsuleApp() {
    const [snapshot, setSnapshot] = useState<OverlaySnapshot>(initialSnapshot);
    const [privacy, setPrivacy] = useState<PrivacyStatus | null>(null);
    const [asr, setAsr] = useState<AsrStatus>({state: 'idle'});

    useEffect(() => {
        const api = window.meetingMonster;
        const unsubscribeOverlay = api.overlay.onSnapshot(setSnapshot);
        const unsubscribePrivacy = api.privacy.onStatus(setPrivacy);
        const unsubscribeAsr = api.asr.onStatus(setAsr);
        void api.overlay.getSnapshot().then(setSnapshot).catch(() => undefined);
        void api.privacy.getStatus().then(setPrivacy).catch(() => undefined);
        void api.asr.getStatus().then(setAsr).catch(() => undefined);
        return () => {
            unsubscribeOverlay();
            unsubscribePrivacy();
            unsubscribeAsr();
        };
    }, []);

    const sendIntent = async (type: 'toggle-workspace' | 'toggle-settings') => {
        try {
            setSnapshot(await window.meetingMonster.overlay.intent({type}));
        } catch {
            // The next main-process snapshot remains authoritative.
        }
    };

    const protectedState = privacy?.captureProtectionEnabled === true && privacy.captureProtection === 'protected';
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
            <button
                className={`capsule-button protection-button ${protectedState ? 'is-protected' : ''}`}
                type="button"
                aria-pressed={protectedState}
                title={protectedState ? '窗口保护已开启' : '窗口保护未开启'}
                onClick={() => void window.meetingMonster.privacy
                    .setCaptureProtection(!protectedState)
                    .then(setPrivacy)
                    .catch(() => setPrivacy({captureProtection: 'failed', captureProtectionEnabled: false, platform: 'win32', windowCount: 1}))}
            >
                {protectedState ? '已保护' : '未保护'}
            </button>
            <button
                className="capsule-button"
                type="button"
                aria-expanded={snapshot.target === 'settings'}
                onClick={() => void sendIntent('toggle-settings')}
            >
                {snapshot.target === 'settings' ? '关闭' : '设置'}
            </button>
            <button
                className="capsule-button"
                type="button"
                aria-expanded={snapshot.target === 'workspace'}
                onClick={() => void sendIntent('toggle-workspace')}
            >
                {snapshot.target === 'workspace' ? '收起' : '展开'} <span aria-hidden="true">⌄</span>
            </button>
            <button
                className="capsule-stop"
                type="button"
                aria-label="退出应用"
                title="退出应用"
                onClick={() => void window.meetingMonster.window.quit().catch(() => undefined)}
            >
                <span aria-hidden="true">■</span>
            </button>
        </main>
    );
}
