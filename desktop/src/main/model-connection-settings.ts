import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {ModelProfileId, ModelProtocol} from '../shared/contracts';

export type {ModelProfileId, ModelProtocol} from '../shared/contracts';

export interface ModelConnection {
    profile_id: ModelProfileId;
    protocol: ModelProtocol;
    base_url: string;
    model: string;
    api_key?: string;
    max_tokens: number;
    temperature?: number | null;
}

export interface ModelConnectionSettings {
    active_profile: ModelProfileId;
    connections: Partial<Record<ModelProfileId, ModelConnection>>;
}

export interface ModelConnectionSummary {
    profile_id: ModelProfileId;
    protocol: ModelProtocol;
    base_url: string;
    model: string;
    has_api_key: boolean;
    max_tokens: number;
    temperature?: number | null;
}

export interface ModelConnectionSummarySettings {
    active_profile: ModelProfileId;
    connections: Partial<Record<ModelProfileId, ModelConnectionSummary>>;
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
    version: 2;
    encryptedConnection: string;
}

const DEFAULT_ACTIVE_PROFILE: ModelProfileId = 'generic_openai';
const PROFILE_PROTOCOL: Record<ModelProfileId, ModelProtocol> = {
    generic_openai: 'openai',
    generic_anthropic: 'anthropic',
};
const CONNECTION_FIELDS = new Set([
    'profile_id', 'protocol', 'base_url', 'model', 'api_key', 'max_tokens', 'temperature',
]);

export class ModelConnectionStore {
    private readonly temporaryPath: string;

    public constructor(private readonly options: ModelConnectionStoreOptions) {
        this.temporaryPath = `${options.settingsPath}.tmp`;
    }

    public async saveConnection(value: ModelConnection): Promise<ModelConnectionSummarySettings> {
        const operation = this.saveConnectionSerial(value);
        this.saveQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    private saveQueue: Promise<void> = Promise.resolve();

    private async saveConnectionSerial(value: ModelConnection): Promise<ModelConnectionSummarySettings> {
        await this.saveQueue;
        const requested = validateModelConnection(value);
        const current = await this.loadSettings() ?? createEmptyModelConnectionSettings();
        const previous = current.connections[requested.profile_id];
        const connection = mergeModelConnectionWithSaved(requested, previous);
        const settings: ModelConnectionSettings = {
            active_profile: connection.profile_id,
            connections: {
                ...current.connections,
                [connection.profile_id]: connection,
            },
        };

        await this.persistSettings(settings);
        return summarizeModelConnectionSettings(settings);
    }

    public async loadSettings(): Promise<ModelConnectionSettings | undefined> {
        const persisted = await this.readPersistedSettings();
        if (!persisted) return undefined;
        if (!this.options.safeStorage.isEncryptionAvailable()) {
            throw new Error('Model connection encryption is unavailable');
        }
        try {
            const plaintext = this.options.safeStorage.decryptString(
                Buffer.from(persisted.encryptedConnection, 'base64'),
            );
            return validateModelConnectionSettings(JSON.parse(plaintext));
        } catch {
            await this.clearConnection();
            throw new Error('Stored model connections could not be decrypted');
        }
    }

    /** Compatibility helper for callers that need the active connection. */
    public async loadConnection(): Promise<ModelConnection | undefined> {
        const settings = await this.loadSettings();
        return settings?.connections[settings.active_profile];
    }

    public async loadSummary(): Promise<ModelConnectionSummarySettings> {
        try {
            const settings = await this.loadSettings();
            return settings ? summarizeModelConnectionSettings(settings) : createEmptyModelConnectionSummary();
        } catch {
            return createEmptyModelConnectionSummary();
        }
    }

    public async clearConnection(): Promise<void> {
        await Promise.all([
            this.fileSystem.unlink(this.options.settingsPath).catch(() => undefined),
            this.fileSystem.unlink(this.temporaryPath).catch(() => undefined),
        ]);
    }

    private async persistSettings(settings: ModelConnectionSettings): Promise<void> {
        if (!this.options.safeStorage.isEncryptionAvailable()) {
            throw new Error('Model connection encryption is unavailable');
        }
        const encryptedConnection = this.options.safeStorage.encryptString(JSON.stringify(settings)).toString('base64');
        const payload: PersistedSettings = {version: 2, encryptedConnection};
        try {
            await this.fileSystem.mkdir(path.dirname(this.options.settingsPath), {recursive: true});
            await this.fileSystem.writeFile(this.temporaryPath, JSON.stringify(payload), {encoding: 'utf8', mode: 0o600});
            await this.fileSystem.rename(this.temporaryPath, this.options.settingsPath);
        } catch {
            await this.fileSystem.unlink(this.temporaryPath).catch(() => undefined);
            throw new Error('Unable to persist encrypted model connections');
        }
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
            const candidate = parsed as {version?: unknown; encryptedConnection?: unknown};
            if (candidate.version === 1) {
                await this.clearConnection();
                return undefined;
            }
            if (candidate.version !== 2
                || typeof candidate.encryptedConnection !== 'string'
                || !candidate.encryptedConnection) {
                throw new Error('invalid settings');
            }
            return {version: 2, encryptedConnection: candidate.encryptedConnection};
        } catch (error: unknown) {
            if (error instanceof Error && error.message === 'invalid settings') {
                throw new Error('Stored model connection settings are invalid');
            }
            throw error;
        }
    }

    private get fileSystem(): Pick<typeof fs, 'readFile' | 'writeFile' | 'mkdir' | 'rename' | 'unlink'> {
        return this.options.fileSystem ?? fs;
    }
}

export function validateModelConnection(value: unknown): ModelConnection {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Model connection is invalid');
    }
    const candidate = value as Partial<ModelConnection>;
    for (const key of Object.keys(candidate)) {
        if (!CONNECTION_FIELDS.has(key)) throw new TypeError('Model connection contains an unsupported field');
    }

    if (!isModelProfileId(candidate.profile_id)) {
        throw new TypeError('Model connection profile_id is invalid');
    }
    if (candidate.protocol !== PROFILE_PROTOCOL[candidate.profile_id]) {
        throw new TypeError('Model connection protocol is invalid for profile_id');
    }
    const baseUrl = normalizeBaseUrl(candidate.base_url);
    const model = requireNonEmptyText(candidate.model, 'Model connection model');
    if (!Number.isInteger(candidate.max_tokens) || (candidate.max_tokens as number) <= 0) {
        throw new TypeError('Model connection max_tokens is invalid');
    }
    if (candidate.temperature !== undefined && candidate.temperature !== null
        && (typeof candidate.temperature !== 'number' || !Number.isFinite(candidate.temperature)
            || candidate.temperature < 0 || candidate.temperature > 2)) {
        throw new TypeError('Model connection temperature is invalid');
    }
    if (candidate.api_key !== undefined && typeof candidate.api_key !== 'string') {
        throw new TypeError('Model connection API key is invalid');
    }

    const connection: ModelConnection = {
        profile_id: candidate.profile_id,
        protocol: candidate.protocol,
        base_url: baseUrl,
        model,
        max_tokens: candidate.max_tokens as number,
    };
    if (candidate.api_key?.trim()) connection.api_key = candidate.api_key.trim();
    if (candidate.temperature !== undefined) connection.temperature = candidate.temperature;
    return connection;
}

export function validateModelConnectionSettings(value: unknown): ModelConnectionSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Model connection settings are invalid');
    }
    const candidate = value as Partial<ModelConnectionSettings>;
    if (!isModelProfileId(candidate.active_profile)) {
        throw new TypeError('Active model profile is invalid');
    }
    if (!candidate.connections || typeof candidate.connections !== 'object' || Array.isArray(candidate.connections)) {
        throw new TypeError('Model connection map is invalid');
    }
    const connections: Partial<Record<ModelProfileId, ModelConnection>> = {};
    for (const [key, valueForProfile] of Object.entries(candidate.connections)) {
        if (!isModelProfileId(key)) throw new TypeError('Model connection profile is invalid');
        const connection = validateModelConnection(valueForProfile);
        if (connection.profile_id !== key) throw new TypeError('Model connection profile key does not match value');
        connections[key] = connection;
    }
    return {active_profile: candidate.active_profile, connections};
}

export function mergeModelConnectionWithSaved(
    value: ModelConnection,
    saved: ModelConnection | undefined,
): ModelConnection {
    const connection = validateModelConnection(value);
    if (!connection.api_key && saved && sameConnectionIdentity(connection, saved) && saved.api_key) {
        connection.api_key = saved.api_key;
    }
    return connection;
}

function summarizeModelConnectionSettings(settings: ModelConnectionSettings): ModelConnectionSummarySettings {
    const connections: Partial<Record<ModelProfileId, ModelConnectionSummary>> = {};
    for (const [profileId, connection] of Object.entries(settings.connections) as [ModelProfileId, ModelConnection][]) {
        connections[profileId] = summarizeModelConnection(connection);
    }
    return {active_profile: settings.active_profile, connections};
}

function summarizeModelConnection(connection: ModelConnection): ModelConnectionSummary {
    return {
        profile_id: connection.profile_id,
        protocol: connection.protocol,
        base_url: connection.base_url,
        model: connection.model,
        has_api_key: Boolean(connection.api_key),
        max_tokens: connection.max_tokens,
        ...(connection.temperature === undefined ? {} : {temperature: connection.temperature}),
    };
}

function createEmptyModelConnectionSettings(): ModelConnectionSettings {
    return {active_profile: DEFAULT_ACTIVE_PROFILE, connections: {}};
}

function createEmptyModelConnectionSummary(): ModelConnectionSummarySettings {
    return {active_profile: DEFAULT_ACTIVE_PROFILE, connections: {}};
}

function sameConnectionIdentity(left: ModelConnection, right: ModelConnection): boolean {
    return left.profile_id === right.profile_id
        && left.protocol === right.protocol
        && left.base_url === right.base_url
        && left.model === right.model;
}

function normalizeBaseUrl(value: unknown): string {
    const baseUrl = requireNonEmptyText(value, 'Model connection base_url').replace(/\/+$/, '');
    if (baseUrl.includes('?') || baseUrl.includes('#')) {
        throw new TypeError('Model connection base_url is invalid: query or fragment is not allowed');
    }
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        throw new TypeError('Model connection base_url is invalid');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new TypeError('Model connection base_url is invalid: HTTP or HTTPS is required');
    }
    return baseUrl;
}

function requireNonEmptyText(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
    return value.trim();
}

function isModelProfileId(value: unknown): value is ModelProfileId {
    return value === 'generic_openai' || value === 'generic_anthropic';
}

function isMissingFile(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
