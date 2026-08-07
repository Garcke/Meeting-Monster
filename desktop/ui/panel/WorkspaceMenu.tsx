import {useEffect, useRef, useState} from 'react';
import type {PrivacyStatus} from '../../src/shared/contracts';
import {isAsrModelReady} from '../shared/services/asr-model-service';
import {useTranscriptionStatus} from '../shared/services/transcription-status-store';

export function WorkspaceMenu() {
    const [open, setOpen] = useState(false);
    const [privacy, setPrivacy] = useState<PrivacyStatus | null>(null);
    const [privacyError, setPrivacyError] = useState('');
    const [panelError, setPanelError] = useState('');
    const [privacyPending, setPrivacyPending] = useState(false);
    const [asrReady, setAsrReady] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const asr = useTranscriptionStatus();
    const privacyActive = privacy?.captureProtectionEnabled === true && privacy.captureProtection === 'protected';
    const recording = asr.state === 'recording';
    const pending = asr.state === 'connecting' || asr.state === 'stopping';
    const transcriptionDisabled = !asrReady || pending;

    useEffect(() => {
        const api = window.meetingMonster;
        const unsubscribe = api.privacy.onStatus(setPrivacy);
        void api.privacy.getStatus().then(setPrivacy).catch(() => setPrivacyError('共享隐藏状态不可用'));
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && open) {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            unsubscribe();
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    useEffect(() => {
        const api = window.meetingMonster;
        const onModelStatus = (snapshot: Parameters<typeof isAsrModelReady>[0]) => {
            setAsrReady(isAsrModelReady(snapshot, snapshot?.currentModelId ?? null));
        };
        const unsubscribe = api.asrModels.onStatus(onModelStatus);
        void api.asrModels.list().then(onModelStatus).catch(() => setAsrReady(false));
        return unsubscribe;
    }, []);

    const togglePrivacy = async () => {
        if (!privacy || privacyPending) return;
        setPrivacyError('');
        setPrivacyPending(true);
        try {
            setPrivacy(await window.meetingMonster.privacy.setCaptureProtection(!privacyActive));
        } catch {
            setPrivacyError('无法更新共享隐藏');
        } finally {
            setPrivacyPending(false);
        }
    };

    const openSettings = async () => {
        setPanelError('');
        setOpen(false);
        try {
            await window.meetingMonster.settings.open();
        } catch {
            setPanelError('设置窗口无法打开');
        }
    };

    const toggleTranscription = () => window.meetingMonster.workspaceCommands.dispatch({type: 'toggle-transcription'});
    const clearChat = () => window.meetingMonster.workspaceCommands.dispatch({type: 'clear-chat'});
    const hideWindow = () => {
        setOpen(false);
        void window.meetingMonster.window.hide().catch(() => setPanelError('窗口无法隐藏'));
    };

    return (
        <div className="workspace-menu no-drag" ref={rootRef}>
            <button ref={triggerRef} className="workspace-menu-trigger" type="button" aria-label="更多" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((visible) => !visible)}>
                <span aria-hidden="true">•••</span>
                {privacy && !privacyActive && <span className="privacy-warning-dot" data-testid="privacy-warning-dot" />}
            </button>
            {open && (
                <div className="workspace-menu-popover" role="menu" aria-label="工作区菜单">
                    <section className="workspace-menu-section" aria-label="窗口">
                        <span className="workspace-menu-section-label">窗口</span>
                        <button className="workspace-menu-item" type="button" role="menuitem" onClick={hideWindow}>
                            <span className="workspace-menu-item-label">显示/隐藏窗口</span><kbd>{'Ctrl+\\'}</kbd>
                        </button>
                        <div className="workspace-menu-reference"><span>移动悬浮窗</span><kbd>Ctrl+↑↓←→</kbd></div>
                        <div className="workspace-menu-reference"><span>滚动聊天</span><kbd>Ctrl+Shift+↑↓</kbd></div>
                    </section>
                    <div className="workspace-menu-separator" role="separator" />
                    <section className="workspace-menu-section" aria-label="会话">
                        <span className="workspace-menu-section-label">会话</span>
                        <button className="workspace-menu-item" type="button" role="menuitemcheckbox" aria-checked={recording} disabled={transcriptionDisabled} onClick={() => void toggleTranscription()}>
                            <span className="workspace-menu-item-label">实时转写</span>
                            <kbd>Ctrl+S</kbd>
                            <span className={`workspace-menu-switch ${recording ? 'is-on' : ''}`} aria-hidden="true" />
                        </button>
                        <button className="workspace-menu-item" type="button" role="menuitem" onClick={() => void clearChat()}>
                            <span className="workspace-menu-item-label">清空聊天</span>
                            <kbd>Ctrl+R</kbd>
                        </button>
                    </section>
                    <div className="workspace-menu-separator" role="separator" />
                    <section className="workspace-menu-section" aria-label="隐私与设置">
                        <button className="workspace-menu-item workspace-menu-privacy-item" type="button" role="menuitemcheckbox" aria-checked={privacyActive} disabled={!privacy || privacyPending} onClick={() => void togglePrivacy()}>
                            <span className="workspace-menu-item-label">截图保护</span>
                            <span className={`workspace-menu-switch ${privacyActive ? 'is-on' : ''}`} aria-hidden="true" />
                            <span className="workspace-menu-privacy-copy">开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。</span>
                        </button>
                        <button className="workspace-menu-item" type="button" role="menuitem" onClick={() => void openSettings()}>设置</button>
                    </section>
                    {privacyError && <div className="workspace-menu-status" role="status">{privacyError}</div>}
                </div>
            )}
            {panelError && <div className="workspace-menu-status workspace-menu-panel-status" role="status">{panelError}</div>}
        </div>
    );
}
