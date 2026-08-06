import type {MeetingMonsterApi, SettingsRendererApi} from '../src/shared/contracts';

declare global {
    interface Window {
        meetingMonster: MeetingMonsterApi;
        meetingMonsterSettings: SettingsRendererApi;
    }
}

export {};
