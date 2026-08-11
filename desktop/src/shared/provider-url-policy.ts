const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function normalizeProviderBaseUrl(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`${label} is invalid`);
    }
    const raw = value.trim();
    if (raw.includes('?') || raw.includes('#')) {
        throw new TypeError(`${label} is invalid: query or fragment is not allowed`);
    }

    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new TypeError(`${label} is invalid`);
    }

    if (parsed.username || parsed.password) {
        throw new TypeError(`${label} is invalid: credentials are not allowed`);
    }
    if (parsed.protocol !== 'https:'
        && (parsed.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(parsed.hostname))) {
        throw new TypeError(`${label} is invalid: HTTPS is required for remote providers`);
    }
    return parsed.href.replace(/\/+$/, '');
}
