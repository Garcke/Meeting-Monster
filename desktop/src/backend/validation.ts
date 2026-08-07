import type {BackendImage, BackendModelSelection, BackendProfileId, BackendProtocol} from './types';

const SELECTION_FIELDS = new Set([
    'profile_id', 'protocol', 'base_url', 'model', 'api_key', 'max_tokens', 'temperature',
]);
const IMAGE_FIELDS = new Set(['media_type', 'data']);

export function validateBackendSelection(value: unknown): BackendModelSelection {
    const input = requireObject(value, 'Backend model selection');
    rejectUnknownFields(input, SELECTION_FIELDS, 'Backend model selection');

    const profileId = input.profile_id;
    if (profileId !== 'generic_openai' && profileId !== 'generic_anthropic') {
        throw new TypeError('Backend model selection field is invalid: profile_id');
    }
    const protocol = input.protocol;
    if (protocol !== 'openai' && protocol !== 'anthropic') {
        throw new TypeError('Backend model selection field is invalid: protocol');
    }
    if (protocol !== expectedProtocol(profileId)) {
        throw new TypeError('Backend model selection field is invalid: protocol');
    }

    const model = input.model;
    if (typeof model !== 'string' || !model.trim()) {
        throw new TypeError('Backend model selection field is invalid: model');
    }
    const apiKey = input.api_key;
    if (apiKey !== undefined && typeof apiKey !== 'string') {
        throw new TypeError('Backend model selection field is invalid: api_key');
    }
    const maxTokens = input.max_tokens;
    if (!Number.isInteger(maxTokens) || (maxTokens as number) <= 0) {
        throw new TypeError('Backend model selection field is invalid: max_tokens');
    }
    const temperature = input.temperature;
    if (temperature !== undefined && temperature !== null
        && (typeof temperature !== 'number' || !Number.isFinite(temperature)
            || temperature < 0 || temperature > 2)) {
        throw new TypeError('Backend model selection field is invalid: temperature');
    }

    return {
        profile_id: profileId,
        protocol,
        base_url: normalizeProviderBaseUrl(input.base_url),
        model: model.trim(),
        ...(apiKey === undefined || apiKey.trim() === '' ? {} : {api_key: apiKey.trim()}),
        max_tokens: maxTokens as number,
        ...(temperature === undefined ? {} : {temperature: temperature as number | null}),
    };
}

export function validateBackendImage(value: unknown): BackendImage {
    const input = requireObject(value, 'Backend image');
    rejectUnknownFields(input, IMAGE_FIELDS, 'Backend image');
    if (input.media_type !== 'image/png' || typeof input.data !== 'string' || !input.data) {
        throw new TypeError('Backend image is invalid');
    }
    return {media_type: 'image/png', data: input.data};
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function rejectUnknownFields(input: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw new TypeError(`${label} contains an unsupported field: ${key}`);
    }
}

function expectedProtocol(profileId: BackendProfileId): BackendProtocol {
    return profileId === 'generic_openai' ? 'openai' : 'anthropic';
}

function normalizeProviderBaseUrl(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError('Backend model selection field is invalid: base_url');
    }
    const raw = value.trim();
    if (raw.includes('?') || raw.includes('#')) {
        throw new TypeError('Backend model selection field is invalid: base_url');
    }
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new TypeError('Backend model selection field is invalid: base_url');
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.search || parsed.hash) {
        throw new TypeError('Backend model selection field is invalid: base_url');
    }
    return parsed.href.replace(/\/+$/, '');
}
