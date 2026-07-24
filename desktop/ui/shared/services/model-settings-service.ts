import type {
    MeetingMonsterApi,
    ModelOptions,
    ModelProfileId,
    ModelSelectionInput,
    ModelTestResult,
    SavedModelConnectionSettings,
    SelectableModelProfile,
} from '../../../src/shared/contracts';

export const BUILT_IN_MODEL_PROFILES: readonly SelectableModelProfile[] = [
    {id: 'generic_openai', label: 'OpenAI Compatible', protocol: 'openai', model: '', api_key_required: false, has_api_key: false, max_tokens: 4096, temperature: 0.3, active: true},
    {id: 'generic_anthropic', label: 'Anthropic Compatible', protocol: 'anthropic', model: '', api_key_required: false, has_api_key: false, max_tokens: 4096, temperature: 0.3, active: false},
];

export interface ModelFormValues {
    baseUrl: string;
    model: string;
    apiKey: string;
    maxTokens: string;
    temperature: string;
}

export function getSavedModelConnection(
    saved: SavedModelConnectionSettings | null,
    profileId: ModelProfileId,
) {
    return saved?.connections[profileId];
}

export function createModelFormValues(
    profile: SelectableModelProfile,
    saved: SavedModelConnectionSettings | null,
): ModelFormValues {
    const connection = getSavedModelConnection(saved, requireModelProfileId(profile.id));
    return {
        baseUrl: connection?.base_url ?? '',
        model: connection?.model ?? profile.model,
        apiKey: '',
        maxTokens: String(connection?.max_tokens ?? profile.max_tokens),
        temperature: String(connection?.temperature ?? profile.temperature ?? ''),
    };
}

function requireModelProfileId(value: string): ModelProfileId {
    if (value !== 'generic_openai' && value !== 'generic_anthropic') {
        throw new TypeError('Model profile is not supported');
    }
    return value;
}

function normalizeBaseUrl(value: string): string {
    const baseUrl = value.trim();
    if (!baseUrl || baseUrl.includes('?') || baseUrl.includes('#')) {
        throw new TypeError('Base URL must be a valid HTTP or HTTPS URL without a query or fragment');
    }
    let parsed: URL;
    try { parsed = new URL(baseUrl); }
    catch { throw new TypeError('Base URL must be a valid HTTP or HTTPS URL'); }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
        throw new TypeError('Base URL must be a valid HTTP or HTTPS URL');
    }
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    if (parsed.protocol === 'http:' && !localHosts.has(parsed.hostname.toLowerCase())) {
        throw new TypeError('Remote Base URL must use HTTPS');
    }
    return parsed.href.replace(/\/+$/, '');
}

export function findInitialProfile(options: ModelOptions | null, saved: SavedModelConnectionSettings | null): SelectableModelProfile {
    const profiles = options?.profiles?.length ? options.profiles : BUILT_IN_MODEL_PROFILES;
    return profiles.find((profile) => profile.id === saved?.active_profile)
        ?? profiles.find((profile) => profile.active)
        ?? profiles[0];
}

export function buildModelSelection(profile: SelectableModelProfile, values: ModelFormValues): ModelSelectionInput {
    const profileId = requireModelProfileId(profile.id);
    const expectedProtocol = profileId === 'generic_openai' ? 'openai' : 'anthropic';
    if (profile.protocol !== expectedProtocol) throw new TypeError('Model protocol does not match profile');
    const baseUrl = normalizeBaseUrl(values.baseUrl);
    const model = values.model.trim();
    if (!model) throw new TypeError('Model ID is required');
    const maxTokens = Number(values.maxTokens || profile.max_tokens);
    const temperature = values.temperature.trim() === '' ? undefined : Number(values.temperature);
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) throw new TypeError('Max tokens must be a positive integer');
    if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
        throw new TypeError('Temperature must be between 0 and 2');
    }
    return {
        profile_id: profileId,
        protocol: profile.protocol,
        base_url: baseUrl,
        model,
        ...(values.apiKey.trim() ? {api_key: values.apiKey.trim()} : {}),
        max_tokens: maxTokens,
        ...(temperature === undefined ? {} : {temperature}),
    };
}

export async function loadModelSettings(api: MeetingMonsterApi): Promise<{options: ModelOptions; saved: SavedModelConnectionSettings | null; profile: SelectableModelProfile}> {
    const [remoteOptions, saved] = await Promise.all([
        api.models.list().catch(() => ({active_profile: '', profiles: [...BUILT_IN_MODEL_PROFILES]})),
        api.models.getSaved().catch(() => null),
    ]);
    const options: ModelOptions = {
        active_profile: saved?.active_profile ?? remoteOptions.active_profile,
        profiles: [...BUILT_IN_MODEL_PROFILES],
    };
    return {options, saved, profile: findInitialProfile(options, saved)};
}

export async function saveModelConnection(api: MeetingMonsterApi, profile: SelectableModelProfile, values: ModelFormValues): Promise<SavedModelConnectionSettings> {
    return api.models.save({...buildModelSelection(profile, values), protocol: profile.protocol});
}

export async function testModelConnection(api: MeetingMonsterApi, profile: SelectableModelProfile, values: ModelFormValues): Promise<ModelTestResult> {
    return api.models.test(buildModelSelection(profile, values));
}
