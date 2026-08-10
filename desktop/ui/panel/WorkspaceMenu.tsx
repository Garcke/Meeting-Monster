import {useEffect, useState, type KeyboardEvent, type ReactNode} from 'react';
import {Alert, Button, Dropdown, type MenuProps} from 'antd';
import type {PrivacyStatus} from '../../src/shared/contracts';
import {isAsrModelReady} from '../shared/services/asr-model-service';
import {useTranscriptionStatus} from '../shared/services/transcription-status-store';

function ShortcutReference({label, shortcut}: {label: string; shortcut: string}) {
    return <span className="workspace-menu-reference"><span>{label}</span><kbd>{shortcut}</kbd></span>;
}

function CheckboxReference({
    label,
    checked,
    shortcut,
    description,
}: {
    label: string;
    checked: boolean;
    shortcut?: string;
    description?: string;
}) {
    return (
        <span className="workspace-menu-checkbox-item">
            <span className="workspace-menu-checkbox-row">
                <span className="workspace-menu-item-label">{label}</span>
                {shortcut && <kbd>{shortcut}</kbd>}
                <span className="workspace-menu-check" data-checked={checked} aria-hidden="true">{checked ? '✓' : ''}</span>
            </span>
            {description && <span className="workspace-menu-privacy-copy">{description}</span>}
        </span>
    );
}

type AccessibleCheckboxItem = {
    key: string;
    disabled: boolean;
    role: 'menuitemcheckbox';
    'aria-checked': boolean;
    label: ReactNode;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

function checkboxItem({
    key,
    disabled,
    checked,
    label,
    activate,
}: {
    key: string;
    disabled: boolean;
    checked: boolean;
    label: ReactNode;
    activate: () => void;
}): NonNullable<MenuProps['items']>[number] {
    const item: AccessibleCheckboxItem = {
        key,
        disabled,
        role: 'menuitemcheckbox',
        'aria-checked': checked,
        label,
        onKeyDown: (event) => {
            if (!disabled && event.key === ' ') {
                event.preventDefault();
                activate();
            }
        },
    };
    return item as unknown as NonNullable<MenuProps['items']>[number];
}

export function WorkspaceMenu() {
    const [open, setOpen] = useState(false);
    const [privacy, setPrivacy] = useState<PrivacyStatus | null>(null);
    const [privacyError, setPrivacyError] = useState('');
    const [panelError, setPanelError] = useState('');
    const [privacyPending, setPrivacyPending] = useState(false);
    const [asrReady, setAsrReady] = useState(false);
    const asr = useTranscriptionStatus();
    const privacyActive = privacy?.captureProtectionEnabled === true && privacy.captureProtection === 'protected';
    const recording = asr.state === 'recording';
    const pending = asr.state === 'connecting' || asr.state === 'stopping';
    const transcriptionDisabled = !asrReady || pending;

    useEffect(() => {
        if (!open) return;
        const frame = window.requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(
                '[aria-label="工作区菜单"] [role="menuitemcheckbox"]:not([aria-disabled="true"]), '
                + '[aria-label="工作区菜单"] [role="menuitem"]:not([aria-disabled="true"])',
            )?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [open]);

    useEffect(() => {
        const api = window.meetingMonster;
        const unsubscribe = api.privacy.onStatus(setPrivacy);
        void api.privacy.getStatus().then(setPrivacy).catch(() => setPrivacyError('共享隐藏状态不可用'));
        return unsubscribe;
    }, []);

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
    const transcriptionItem = checkboxItem({
        key: 'transcription',
        disabled: transcriptionDisabled,
        checked: recording,
        activate: () => void toggleTranscription(),
        label: <CheckboxReference label="实时转写" checked={recording} shortcut="Ctrl+S" />,
    });
    const privacyItem = checkboxItem({
        key: 'privacy',
        disabled: !privacy || privacyPending,
        checked: privacyActive,
        activate: () => void togglePrivacy(),
        label: (
            <CheckboxReference
                label="应用隐藏"
                checked={privacyActive}
                description="开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。"
            />
        ),
    });
    const menuItems: MenuProps['items'] = [
        {
            type: 'group',
            label: '窗口',
            children: [
                {key: 'show-hide', disabled: true, label: <ShortcutReference label="显示/隐藏窗口" shortcut={'Ctrl+\\'} />},
                {key: 'move-panel', disabled: true, label: <ShortcutReference label="移动悬浮窗" shortcut="Ctrl+↑↓←→" />},
                {key: 'scroll-chat', disabled: true, label: <ShortcutReference label="滚动聊天" shortcut="Ctrl+Shift+↑↓" />},
            ],
        },
        {type: 'divider'},
        {
            type: 'group',
            label: '会话',
            children: [
                transcriptionItem,
                {key: 'clear-chat', label: <ShortcutReference label="清空聊天" shortcut="Ctrl+R" />},
            ],
        },
        {type: 'divider'},
        {
            type: 'group',
            label: '隐私与设置',
            children: [
                privacyItem,
                ...(privacyError ? [{
                    key: 'privacy-error',
                    disabled: true,
                    label: <Alert className="workspace-menu-alert" type="error" showIcon title={privacyError} />,
                }] : []),
                {key: 'settings', label: '设置'},
            ],
        },
    ];

    const onMenuClick: MenuProps['onClick'] = ({key}) => {
        if (key === 'transcription' && !transcriptionDisabled) void toggleTranscription();
        if (key === 'clear-chat') void clearChat();
        if (key === 'privacy' && privacy && !privacyPending) void togglePrivacy();
        if (key === 'settings') void openSettings();
    };

    return (
        <div className="workspace-menu no-drag">
            <Dropdown
                open={open}
                onOpenChange={setOpen}
                trigger={['click']}
                placement="bottomRight"
                autoFocus
                getPopupContainer={(triggerNode) => triggerNode.closest('.panel-shell') ?? triggerNode.parentElement ?? document.body}
                classNames={{root: 'workspace-menu-popover no-drag'}}
                menu={{items: menuItems, onClick: onMenuClick, selectable: true, multiple: true, selectedKeys: [], 'aria-label': '工作区菜单'}}
            >
                <Button className="workspace-menu-trigger" type="text" aria-label="更多" aria-expanded={open} aria-haspopup="menu">
                    <span aria-hidden="true">•••</span>
                    {privacy && !privacyActive && <span className="privacy-warning-dot" data-testid="privacy-warning-dot" />}
                </Button>
            </Dropdown>
            {panelError && <Alert className="workspace-menu-panel-alert" type="error" showIcon title={panelError} />}
        </div>
    );
}
