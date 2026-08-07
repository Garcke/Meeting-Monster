import type {BackendImage, BackendModelSelection} from './types';
import type {NormalizedProviderError} from './providers/provider';

const MESSAGES: Record<NormalizedProviderError['kind'], {label: string; guidance: string}> = {
    authentication: {label: '认证失败', guidance: '请检查 API Key 或账号区域'},
    not_found: {label: '模型不存在', guidance: '请检查 Model ID'},
    invalid_request: {label: '请求无效', guidance: '请检查模型连接配置'},
    rate_limited: {label: '请求过于频繁', guidance: '请稍后重试'},
    timeout: {label: '连接超时', guidance: '请稍后重试'},
    unreachable: {label: '无法连接到模型服务', guidance: '请检查网络或 Base URL'},
    upstream: {label: '模型服务暂时不可用', guidance: '请稍后重试'},
    unknown: {label: '模型连接失败', guidance: '请稍后重试'},
};

export function classifyProviderError(error: unknown): NormalizedProviderError {
    const status = findStatus(error);
    const kind = statusKind(status) ?? nameKind(error) ?? 'unknown';
    return {kind, message: formatMessage(kind, status), ...(status === undefined ? {} : {status})};
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
        const record = asRecord(value);
        const code = String(record?.code ?? '').toUpperCase();
        if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
            return 'unreachable';
        }
        if (code === 'ETIMEDOUT') return 'timeout';
        const name = value instanceof Error ? value.name.toLowerCase() : String(record?.name ?? '').toLowerCase();
        if (/(authentication|auth|unauthorized)/.test(name)) return 'authentication';
        if (/timeout/.test(name)) return 'timeout';
        if (/(connection|connect|network|dns|socket)/.test(name)) return 'unreachable';
    }
    return undefined;
}

function formatMessage(kind: NormalizedProviderError['kind'], status?: number): string {
    const {label, guidance} = MESSAGES[kind];
    return `${label}${status === undefined ? '' : `（HTTP ${status}）`}：${guidance}`;
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
