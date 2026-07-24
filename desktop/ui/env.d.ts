import type {MeetingMonsterApi} from '../src/shared/contracts';

declare global {
    interface Window {
        meetingMonster: MeetingMonsterApi;
    }
}

export {};
