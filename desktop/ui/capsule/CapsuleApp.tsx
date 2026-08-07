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
                {snapshot.target === 'workspace' ? (
                    <>
                        <svg className="capsule-chevron" viewBox="0 0 14 14" aria-hidden="true">
                            <path d="M3.5 5.25 7 8.75l3.5-3.5" />
                        </svg>
                        <span>Hide</span>
                    </>
                ) : (
                    <>
                        <svg className="capsule-chat-symbol" viewBox="0 0 1259 1024" aria-hidden="true">
                            <path d="M635.211887 354.085959c-236.873121 0-430.651342 311.057206-430.651342 430.651342 0 236.906195 193.778221 239.254421 430.651342 239.254421 236.873121 0 430.618269-2.381299 430.618269-239.221347 0-119.62721-193.745147-430.684416-430.618269-430.684416z m0 574.256912c-184.219951 0-334.936345 0-334.936344-143.572496 0-71.769711 150.716394-334.969418 334.936344-334.969419s334.936345 263.199707 334.936345 334.936345c0 167.484709-150.716394 143.539423-334.936345 143.539423v0.066147zM139.934731 258.404035A139.702885 139.702885 0 0 0 0.000331 398.305362a139.702885 139.702885 0 0 0 139.9344 139.967474 139.702885 139.702885 0 0 0 140.000548-139.934401A139.702885 139.702885 0 0 0 139.901658 258.370961z m0 193.745147a53.314643 53.314643 0 0 1-53.810747-53.810747c0-30.196197 23.680697-53.84382 53.810747-53.84382 30.196197 0 53.876894 23.680697 53.876894 53.84382a53.347716 53.347716 0 0 1-53.876894 53.843821z m979.739245-172.247307a139.702885 139.702885 0 0 0-139.967474 139.967474 139.702885 139.702885 0 0 0 139.967474 139.9344 139.702885 139.702885 0 0 0 139.967474-139.9344 139.702885 139.702885 0 0 0-139.967474-139.967474z m0 193.811294a53.314643 53.314643 0 0 1-53.84382-53.84382c0-30.163123 23.713771-53.810747 53.84382-53.810747 30.163123 0 53.810747 23.680697 53.810747 53.810747a53.347716 53.347716 0 0 1-53.810747 53.810746zM861.236868 21.49784a139.702885 139.702885 0 0 0-139.934401 139.967474 139.702885 139.702885 0 0 0 139.934401 139.967474 139.702885 139.702885 0 0 0 140.000548-139.967474A139.702885 139.702885 0 0 0 861.236868 21.49784z m0 193.811294a53.314643 53.314643 0 0 1-53.810747-53.810746c0-30.196197 23.680697-53.84382 53.810747-53.843821 30.196197 0 53.84382 23.680697 53.84382 53.843821A53.347716 53.347716 0 0 1 861.236868 215.309134zM452.182586 0C363.876075 0 290.717272 73.158803 290.717272 161.498388c0 88.240364 73.191876 161.465314 161.498388 161.465313s161.498388-73.191876 161.498387-161.498387S540.456024 0 452.182586 0z m0 236.840048c-40.912043 0-75.34166-34.462691-75.34166-75.34166 0-40.945116 34.429617-75.407807 75.34166-75.407808 40.945116 0 75.34166 34.462691 75.341661 75.407808 0 40.912043-34.429617 75.34166-75.308587 75.34166z" />
                        </svg>
                        <span>Chat</span>
                    </>
                )}
            </button>
            <button className="capsule-stop" type="button" aria-label="退出应用" title="退出应用" onClick={() => void window.meetingMonster.window.quit().catch(() => undefined)}>
                <span aria-hidden="true">■</span>
            </button>
        </main>
    );
}
