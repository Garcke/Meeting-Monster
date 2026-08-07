export interface NormalizedProviderError {
    status?: number;
    kind: 'authentication' | 'not_found' | 'invalid_request' | 'rate_limited' | 'timeout' | 'unreachable' | 'upstream' | 'unknown';
    message: string;
}

export type BackendFetch = (input: string, init?: RequestInit) => Promise<Response>;
