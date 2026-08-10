import type {ModelDiagnosticCode} from './contracts';

const MESSAGES: Record<ModelDiagnosticCode, {label: string; guidance: string}> = {
    authentication_failed: {label: '认证失败', guidance: '请检查 API Key 或账号区域'},
    model_not_found: {label: '模型不存在', guidance: '请检查 Model ID'},
    invalid_request: {label: '请求无效', guidance: '请检查模型连接配置'},
    rate_limited: {label: '请求过于频繁', guidance: '请稍后重试'},
    timeout: {label: '连接超时', guidance: '请稍后重试'},
    unreachable: {label: '无法连接到模型服务', guidance: '请检查网络或 Base URL'},
    upstream_error: {label: '模型服务暂时不可用', guidance: '请稍后重试'},
    vision_verification_failed: {label: '图片能力验证未通过', guidance: '请确认模型支持图片输入'},
    unknown: {label: '模型连接失败', guidance: '请稍后重试'},
};

export function formatModelConnectionError(error: unknown): string {
    const candidate = asRecord(error);
    const code = isModelDiagnosticCode(candidate?.code) ? candidate.code : undefined;
    const providerStatus = asHttpStatus(candidate?.providerStatus) ?? asHttpStatus(candidate?.provider_status);
    const status = asHttpStatus(candidate?.status);
    if (code) return formatDiagnostic(code, providerStatus ?? status);

    const knownMessage = findSafeDiagnosticMessage(candidate?.message);
    return knownMessage ?? formatDiagnostic('unknown', providerStatus ?? status);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function isModelDiagnosticCode(value: unknown): value is ModelDiagnosticCode {
    return typeof value === 'string' && Object.hasOwn(MESSAGES, value);
}

function asHttpStatus(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
        ? value
        : undefined;
}

function formatDiagnostic(code: ModelDiagnosticCode, status?: number): string {
    const {label, guidance} = MESSAGES[code];
    return `${label}${status === undefined ? '' : `（HTTP ${status}）`}：${guidance}`;
}

function findSafeDiagnosticMessage(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const statusMatch = value.match(/（HTTP (\d{3})）/);
    const status = asHttpStatus(statusMatch?.[1] === undefined ? undefined : Number(statusMatch[1]));
    for (const code of Object.keys(MESSAGES) as ModelDiagnosticCode[]) {
        const message = formatDiagnostic(code, status);
        if (value.includes(message)) return message;
        if (status !== undefined && value.includes(formatDiagnostic(code))) return formatDiagnostic(code);
    }
    return undefined;
}
