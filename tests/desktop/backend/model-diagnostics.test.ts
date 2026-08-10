import {describe, expect, it} from 'vitest';
import {classifyProviderError, sanitizeProviderError} from '../../../desktop/src/backend/model-diagnostics';
import type {BackendImage, BackendModelSelection} from '../../../desktop/src/backend/types';

const selection: BackendModelSelection = {
    profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://provider.example/v1',
    model: 'vision-model', api_key: 'provider-secret', max_tokens: 256,
};

describe('provider diagnostics', () => {
    it.each([
        [401, 'authentication'], [403, 'authentication'], [404, 'not_found'],
        [400, 'invalid_request'], [422, 'invalid_request'], [429, 'rate_limited'],
        [408, 'timeout'], [504, 'timeout'], [500, 'upstream'], [599, 'upstream'],
    ] as const)('classifies provider HTTP status %i as %s', (status, kind) => {
        expect(classifyProviderError({status})).toMatchObject({status, kind});
    });

    it('classifies network and unknown errors without trusting their text', () => {
        const network = new Error('socket disconnected');
        network.name = 'NetworkError';
        expect(classifyProviderError(network).kind).toBe('unreachable');
        const nativeFetchError = Object.assign(new TypeError('fetch failed'), {cause: {code: 'ECONNREFUSED'}});
        expect(classifyProviderError(nativeFetchError).kind).toBe('unreachable');
        expect(classifyProviderError(new Error('provider-secret upstream detail')).kind).toBe('unknown');
    });

    it('returns a fixed safe error message without secrets or upstream response text', () => {
        const image: BackendImage = {media_type: 'image/png', data: 'image-secret'};
        const safe = sanitizeProviderError(
            Object.assign(new Error('provider-secret image-secret https://provider.example/v1 raw upstream failure'), {status: 401}),
            selection,
            image,
        );
        expect(safe).not.toContain('provider-secret');
        expect(safe).not.toContain('image-secret');
        expect(safe).not.toContain('raw upstream failure');
        expect(safe).toBe(classifyProviderError({status: 401}).message);
    });
});
