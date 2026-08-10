import {useEffect, useState} from 'react';
import {Button} from 'antd';
import {ModelSettingsPage} from './ModelSettingsPage';
import {SpeechSettingsPage} from './SpeechSettingsPage';

type SettingsSection = 'models' | 'speech';

export function SettingsApp() {
    const [section, setSection] = useState<SettingsSection>('models');
    const [version, setVersion] = useState('');

    useEffect(() => {
        let disposed = false;
        void window.meetingMonsterSettings.settings.getAppVersion()
            .then((value) => { if (!disposed) setVersion(value); })
            .catch(() => { if (!disposed) setVersion('未知'); });
        return () => { disposed = true; };
    }, []);

    return (
        <main className="settings-window-shell">
            <header className="settings-titlebar">
                <Button className="settings-close" type="text" aria-label="关闭设置" onClick={() => void window.meetingMonsterSettings.settings.close()}>×</Button>
            </header>
            <aside className="settings-sidebar">
                <div className="settings-brand" aria-hidden="true">
                    <span className="settings-brand-mark" />
                    <span>Meeting-Monster</span>
                </div>
                <nav aria-label="设置分类">
                    <Button type="text" aria-current={section === 'models' ? 'page' : undefined} className={section === 'models' ? 'settings-nav is-active' : 'settings-nav'} onClick={() => setSection('models')}>AI 与模型</Button>
                    <Button type="text" aria-current={section === 'speech' ? 'page' : undefined} className={section === 'speech' ? 'settings-nav is-active' : 'settings-nav'} onClick={() => setSection('speech')}>语音与转写</Button>
                </nav>
                <span className="settings-version">Meeting-Monster v{version}</span>
            </aside>
            <section className="settings-main">
                <ModelSettingsPage active={section === 'models'} />
                <SpeechSettingsPage active={section === 'speech'} />
            </section>
        </main>
    );
}
