import {useEffect, useRef, useState} from 'react';
import type {PrivacyStatus} from '../../src/shared/contracts';

export function WorkspaceMenu() {
    const [open, setOpen] = useState(false);
    const [privacy, setPrivacy] = useState<PrivacyStatus | null>(null);
    const [privacyError, setPrivacyError] = useState('');
    const [panelError, setPanelError] = useState('');
    const [privacyPending, setPrivacyPending] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const privacyActive = privacy?.captureProtectionEnabled === true && privacy.captureProtection === 'protected';

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

    return (
        <div className="workspace-menu no-drag" ref={rootRef}>
            <button ref={triggerRef} className="workspace-menu-trigger" type="button" aria-label="更多" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((visible) => !visible)}>
                <span aria-hidden="true">•••</span>
                {privacy && !privacyActive && <span className="privacy-warning-dot" data-testid="privacy-warning-dot" />}
            </button>
            {open && (
                <div className="workspace-menu-popover" role="menu" aria-label="工作区菜单">
                    <button className="workspace-menu-item workspace-privacy-item" type="button" role="menuitemcheckbox" aria-checked={privacyActive} disabled={!privacy || privacyPending} onClick={() => void togglePrivacy()}>
                        <span className="workspace-menu-item-label">共享隐藏</span>
                        <span className="workspace-menu-item-state">{privacyActive ? '已开启' : '未开启'}</span>
                        <span className="workspace-menu-help">开启后会尽量让悬浮窗口避开常见的屏幕共享和录屏画面，实际效果取决于系统与录制工具。</span>
                    </button>
                    <button className="workspace-menu-item" type="button" role="menuitem" onClick={() => void openSettings()}>设置</button>
                    {privacyError && <div className="workspace-menu-status" role="status">{privacyError}</div>}
                </div>
            )}
            {panelError && <div className="workspace-menu-status workspace-menu-panel-status" role="status">{panelError}</div>}
        </div>
    );
}
