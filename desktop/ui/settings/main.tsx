import {createRoot} from 'react-dom/client';
import {MeetingMonsterConfigProvider} from '../shared/antd-theme';
import {SettingsApp} from './SettingsApp';
import './settings.css';

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(
    <MeetingMonsterConfigProvider variant="light">
        <SettingsApp />
    </MeetingMonsterConfigProvider>,
);
