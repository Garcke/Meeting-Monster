import type {BackendImage, BackendModelSelection} from './types';
import type {NormalizedProviderError} from './providers/provider';

const MESSAGES: Record<NormalizedProviderError['kind'], string> = {
    authentication: 'Authentication failed: check your API key or account region.',
    not_found: 'Model not found: check the model ID.',
    invalid_request: 'Invalid request: check the model connection settings.',
    rate_limited: 'Too many requests: please try again shortly.',
    timeout: 'Connection timed out: please try again shortly.',
    unreachable: 'Unable to reach the model service: check your network or Base URL.',
    upstream: 'The model service is temporarily unavailable: please try again shortly.',
    unknown: 'Model connection failed: please try again shortly.',
};

export function classifyProviderError(error: unknown): NormalizedProviderError {
    const status = findStatus(error);
    const kind = statusKind(status) ?? nameKind(error) ?? 'unknown';
    return {kind, message: MESSAGES[kind], ...(status === undefined ? {} : {status})};
}

/** Return only stable local text; provider response text is deliberately never surfaced. */
export function sanitizeProviderError(
    error: unknown,
    _selection: BackendModelSelection,
    _image?: BackendImage,
): string {
    return classifyProviderError(error).message;
}

function findStatus(error: unknown): number | undefined {
    for (const value of errorChain(error)) {
        const record = asRecord(value);
        const candidate = record?.status ?? record?.status_code ?? asRecord(record?.response)?.status
            ?? asRecord(record?.response)?.status_code;
        if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
            return candidate;
        }
    }
    return undefined;
}

function nameKind(error: unknown): NormalizedProviderError['kind'] | undefined {
    for (const value of errorChain(error)) {
        const name = value instanceof Error ? value.name.toLowerCase() : String(asRecord(value)?.name ?? '').toLowerCase();
        if (/(authentication|auth|unauthorized)/.test(name)) return 'authentication';
        if (/timeout/.test(name)) return 'timeout';
        if (/(connection|connect|network|dns|socket)/.test(name)) return 'unreachable';
    }
    return undefined;
}

function statusKind(status: number | undefined): NormalizedProviderError['kind'] | undefined {
    if (status === 401 || status === 403) return 'authentication';
    if (status === 404) return 'not_found';
    if (status === 400 || status === 422) return 'invalid_request';
    if (status === 429) return 'rate_limited';
    if (status === 408 || status === 504) return 'timeout';
    if (status !== undefined && status >= 500) return 'upstream';
    return undefined;
}

function* errorChain(error: unknown): Generator<unknown> {
    let current = error;
    const seen = new Set<object>();
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        yield current;
        current = asRecord(current)?.cause;
    }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}
