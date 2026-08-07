import {describe, expect, it} from 'vitest';
import {classifyProviderError, sanitizeProviderError} from '../../../desktop/src/backend/model-diagnostics';
import {parseSse} from '../../../desktop/src/backend/sse';
import type {BackendImage, BackendModelSelection} from '../../../desktop/src/backend/types';

const encoder = new TextEncoder();
const selection: BackendModelSelection = {
    profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://provider.example/v1',
    model: 'vision-model', api_key: 'provider-secret', max_tokens: 256,
};

function responseFromChunks(chunks: Uint8Array[]): Response {
    return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
        },
    }));
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
    const result: T[] = [];
    for await (const event of events) result.push(event);
    return result;
}

describe('parseSse', () => {
    it('parses fragmented UTF-8 CRLF events, comments, multiple data lines, and DONE', async () => {
        const source = ': keepalive\r\nevent: chunk\r\ndata: 你好\r\ndata: world\r\n\r\nevent: done\r\ndata: [DONE]\r\n\r\n';
        const bytes = encoder.encode(source);
        const splitInsideCharacter = bytes.findIndex((value, index) => index > 20 && value >= 0x80);
        const response = responseFromChunks([
            bytes.slice(0, splitInsideCharacter + 1),
            bytes.slice(splitInsideCharacter + 1, splitInsideCharacter + 5),
            bytes.slice(splitInsideCharacter + 5),
        ]);

        await expect(collect(parseSse(response, new AbortController().signal))).resolves.toEqual([
            {event: 'chunk', data: '你好\nworld'},
            {event: 'done', data: '[DONE]'},
        ]);
    });

    it('does not read an already aborted stream', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(collect(parseSse(responseFromChunks([encoder.encode('data: ignored\n\n')]), controller.signal)))
            .resolves.toEqual([]);
    });
});

describe('provider diagnostics', () => {
    it.each([
        [401, 'authentication'], [403, 'authentication'], [404, 'not_found'], [400, 'invalid_request'],
        [422, 'invalid_request'], [429, 'rate_limited'], [408, 'timeout'], [504, 'timeout'],
        [500, 'upstream'], [599, 'upstream'],
    ] as const)('classifies provider HTTP status %i as %s', (status, kind) => {
        expect(classifyProviderError({status})).toMatchObject({status, kind});
    });

    it('classifies network and unknown errors without trusting their text', () => {
        const network = new Error('socket disconnected');
        network.name = 'NetworkError';
        expect(classifyProviderError(network).kind).toBe('unreachable');
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
