export type AudioInputMode = 'system' | 'microphone' | 'mixed';
export type AudioInputPlatform = NodeJS.Platform | string;

export const AUDIO_INPUT_MODE_STORAGE_KEY = 'meeting-monster.audio-input-mode';
export const AUDIO_INPUT_MODE_EVENT = 'meeting-monster:audio-input-mode';

export interface AudioInputModeStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export function getDefaultAudioInputMode(platform: AudioInputPlatform): AudioInputMode {
    return platform === 'win32' ? 'system' : 'microphone';
}

export function normalizeAudioInputMode(value: unknown, platform: AudioInputPlatform): AudioInputMode {
    if (platform !== 'win32') return 'microphone';
    return value === 'system' || value === 'microphone' || value === 'mixed'
        ? value
        : getDefaultAudioInputMode(platform);
}

export function readAudioInputMode(
    storage: AudioInputModeStorage,
    platform: AudioInputPlatform,
): AudioInputMode {
    return normalizeAudioInputMode(storage.getItem(AUDIO_INPUT_MODE_STORAGE_KEY), platform);
}

export function writeAudioInputMode(
    storage: AudioInputModeStorage,
    mode: AudioInputMode,
    platform: AudioInputPlatform,
): AudioInputMode {
    const normalizedMode = normalizeAudioInputMode(mode, platform);
    storage.setItem(AUDIO_INPUT_MODE_STORAGE_KEY, normalizedMode);
    return normalizedMode;
}
