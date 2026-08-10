export type AudioInputMode = 'system' | 'microphone' | 'mixed';
export type AudioInputPlatform = 'win32' | 'darwin' | 'linux' | string;

export function getDefaultAudioInputMode(platform: AudioInputPlatform): AudioInputMode {
    return platform === 'win32' ? 'mixed' : 'microphone';
}

export function normalizeAudioInputMode(value: unknown, platform: AudioInputPlatform): AudioInputMode {
    if (platform !== 'win32') return 'microphone';
    return value === 'system' || value === 'microphone' || value === 'mixed' ? value : 'mixed';
}
