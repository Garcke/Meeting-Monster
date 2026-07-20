import {promises as fs} from 'node:fs';
import path from 'node:path';

export type ModelProtocol = 'openai' | 'anthropic';

export interface ModelConnection {
    profile_id: string;
    protocol: ModelProtocol;
    api_key?: string;
    max_tokens?: number;
    temperature?: number | null;
}

export interface ModelConnectionSummary {
    profile_id: string;
    protocol: ModelProtocol;
    has_api_key: boolean;
    max_tokens?: number;
    temperature?: number | null;
}

export interface ModelConnectionStoreOptions {
    safeStorage: SafeStorageLike;
    settingsPath: string;
    fileSystem?: Pick<typeof fs, 'readFile' | 'writeFile' | 'mkdir' | 'rename' | 'unlink'>;
}

export interface SafeStorageLike {
    isEncryptionAvailable(): boolean;
    encryptString(plaintext: string): Buffer;
    decryptString(ciphertext: Buffer): string;
}

interface PersistedSettings {
    version: 1;
    encryptedConnection: string;
}

export class ModelConnectionStore {
    private readonly temporaryPath: string;

    public constructor(private readonly options: ModelConnectionStoreOptions) {
        this.temporaryPath = `${options.settingsPath}.tmp`;
    }

    public async saveConnection(value: ModelConnection): Promise<ModelConnectionSummary> {
        const connection = validateModelConnection(value);
        if (!this.options.safeStorage.isEncryptionAvailable()) {
            throw new Error('Model connection encryption is unavailable');
        }

        const encryptedConnection = this.options.safeStorage.encryptString(JSON.stringify(connection)).toString('base64');
        const payload: PersistedSettings = {version: 1, encryptedConnection};
        try {
            await this.fileSystem.mkdir(path.dirname(this.options.settingsPath), {recursive: true});
            await this.fileSystem.writeFile(this.temporaryPath, JSON.stringify(payload), {encoding: 'utf8', mode: 0o600});
            await this.fileSystem.rename(this.temporaryPath, this.options.settingsPath);
        } catch {
            await this.fileSystem.unlink(this.temporaryPath).catch(() => undefined);
            throw new Error('Unable to persist encrypted model connection');
        }
        return summarizeModelConnection(connection);
    }

    public async loadConnection(): Promise<ModelConnection | undefined> {
        const persisted = await this.readPersistedSettings();
        if (!persisted) return undefined;
        try {
            if (!this.options.safeStorage.isEncryptionAvailable()) {
                throw new Error('Model connection encryption is unavailable');
            }
            const plaintext = this.options.safeStorage.decryptString(Buffer.from(persisted.encryptedConnection, 'base64'));
            return validateModelConnection(JSON.parse(plaintext));
        } catch {
            await this.clearConnection();
            throw new Error('Stored model connection could not be decrypted');
        }
    }

    public async loadSummary(): Promise<ModelConnectionSummary | null> {
        try {
            const connection = await this.loadConnection();
            return connection ? summarizeModelConnection(connection) : null;
        } catch {
            return null;
        }
    }

    public async clearConnection(): Promise<void> {
        await Promise.all([
            this.fileSystem.unlink(this.options.settingsPath).catch(() => undefined),
            this.fileSystem.unlink(this.temporaryPath).catch(() => undefined),
        ]);
    }

    private async readPersistedSettings(): Promise<PersistedSettings | undefined> {
        let raw: string;
        try {
            raw = await this.fileSystem.readFile(this.options.settingsPath, 'utf8');
        } catch (error: unknown) {
            if (isMissingFile(error)) return undefined;
            throw new Error('Unable to read model connection settings');
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid settings');
            const candidate = parsed as Partial<PersistedSettings>;
            if (candidate.version !== 1 || typeof candidate.encryptedConnection !== 'string' || !candidate.encryptedConnection) {
                throw new Error('invalid settings');
            }
            return {version: 1, encryptedConnection: candidate.encryptedConnection};
        } catch {
            throw new Error('Stored model connection settings are invalid');
        }
    }

    private get fileSystem(): Pick<typeof fs, 'readFile' | 'writeFile' | 'mkdir' | 'rename' | 'unlink'> {
        return this.options.fileSystem ?? fs;
    }
}

export function validateModelConnection(value: unknown): ModelConnection {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Model connection is invalid');
    const candidate = value as Partial<ModelConnection>;
    if (typeof candidate.profile_id !== 'string' || !candidate.profile_id.trim()) {
        throw new TypeError('Model connection profile_id is required');
    }
    if (candidate.protocol !== 'openai' && candidate.protocol !== 'anthropic') {
        throw new TypeError('Model connection protocol is invalid');
    }
    if (candidate.api_key !== undefined && typeof candidate.api_key !== 'string') {
        throw new TypeError('Model connection API key is invalid');
    }
    if (candidate.max_tokens !== undefined && (!Number.isInteger(candidate.max_tokens) || candidate.max_tokens <= 0)) {
        throw new TypeError('Model connection max_tokens is invalid');
    }
    if (candidate.temperature !== undefined && candidate.temperature !== null
        && (typeof candidate.temperature !== 'number' || !Number.isFinite(candidate.temperature)
            || candidate.temperature < 0 || candidate.temperature > 2)) {
        throw new TypeError('Model connection temperature is invalid');
    }
    const connection: ModelConnection = {
        profile_id: candidate.profile_id.trim(),
        protocol: candidate.protocol,
    };
    if (candidate.api_key?.trim()) connection.api_key = candidate.api_key.trim();
    if (candidate.max_tokens !== undefined) connection.max_tokens = candidate.max_tokens;
    if (candidate.temperature !== undefined) connection.temperature = candidate.temperature;
    return connection;
}

function summarizeModelConnection(connection: ModelConnection): ModelConnectionSummary {
    return {
        profile_id: connection.profile_id,
        protocol: connection.protocol,
        has_api_key: Boolean(connection.api_key),
        ...(connection.max_tokens === undefined ? {} : {max_tokens: connection.max_tokens}),
        ...(connection.temperature === undefined ? {} : {temperature: connection.temperature}),
    };
}

function isMissingFile(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
