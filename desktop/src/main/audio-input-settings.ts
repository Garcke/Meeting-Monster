import {promises as fs} from 'node:fs';
import path from 'node:path';
import {getDefaultAudioInputMode, normalizeAudioInputMode, type AudioInputMode, type AudioInputPlatform} from '../shared/audio-input-mode';

type PersistedAudioInputSettings = {version: 1; mode: AudioInputMode};
export interface AudioInputSettingsStoreOptions { platform: AudioInputPlatform; settingsPath: string; fileSystem?: Pick<typeof fs, 'readFile' | 'writeFile' | 'mkdir' | 'rename' | 'unlink'>; }

export class AudioInputSettingsStore {
    private readonly temporaryPath: string;
    private readonly fileSystem: NonNullable<AudioInputSettingsStoreOptions['fileSystem']>;
    public constructor(private readonly options: AudioInputSettingsStoreOptions) {
        this.temporaryPath = `${options.settingsPath}.tmp`;
        this.fileSystem = options.fileSystem ?? fs;
    }
    public async load(): Promise<AudioInputMode> {
        const fallback = getDefaultAudioInputMode(this.options.platform);
        try {
            const parsed: unknown = JSON.parse(await this.fileSystem.readFile(this.options.settingsPath, 'utf8'));
            if (!isPersistedAudioInputSettings(parsed)) return fallback;
            const normalized = normalizeAudioInputMode(parsed.mode, this.options.platform);
            return normalized === parsed.mode ? normalized : fallback;
        } catch { return fallback; }
    }
    public async save(value: unknown): Promise<AudioInputMode> {
        const mode = normalizeAudioInputMode(value, this.options.platform);
        try {
            await this.fileSystem.mkdir(path.dirname(this.options.settingsPath), {recursive: true});
            await this.fileSystem.writeFile(this.temporaryPath, JSON.stringify({version: 1, mode}), {encoding: 'utf8', mode: 0o600});
            await this.fileSystem.rename(this.temporaryPath, this.options.settingsPath);
            return mode;
        } catch {
            try { await this.fileSystem.unlink(this.temporaryPath); } catch {}
            throw new Error('Unable to persist audio input preference');
        }
    }
}
function isPersistedAudioInputSettings(value: unknown): value is PersistedAudioInputSettings {
    return typeof value === 'object' && value !== null && (value as {version?: unknown}).version === 1 && typeof (value as {mode?: unknown}).mode === 'string';
}
