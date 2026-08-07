import {describe, expect, it} from 'vitest';
import {createAnthropicProvider} from '../../../desktop/src/backend/providers/anthropic-provider';
import {ProviderCache} from '../../../desktop/src/backend/providers/provider-cache';
import {createOpenAiProvider} from '../../../desktop/src/backend/providers/openai-provider';
import type {BackendModelSelection, BackendProvider, ChatMessage} from '../../../desktop/src/backend/types';

const encoder = new TextEncoder();
const openAiSelection: BackendModelSelection = {
    profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://provider.example/v1/',
    model: 'vision-model', api_key: 'test-key', max_tokens: 256, temperature: 0.3,
};
const anthropicSelection: BackendModelSelection = {
    profile_id: 'generic_anthropic', protocol: 'anthropic', base_url: 'https://provider.example/',
    model: 'claude-test', api_key: 'anthropic-key', max_tokens: 512, temperature: null,
};

function sseResponse(data: string): Response {
    return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encoder.encode(data));
            controller.close();
        },
    }));
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
}

describe('direct OpenAI provider', () => {
    it('posts serialized messages and yields streamed text', async () => {
        let url = '';
        let init: RequestInit | undefined;
        const provider = createOpenAiProvider(openAiSelection, async (input, request) => {
            url = input;
            init = request;
            return sseResponse('data: {"choices":[{"delta":{"content":"hello "}}]}\n\ndata: {"choices":[{"delta":{"content":"world"}}]}\n\ndata: [DONE]\n\n');
        });
        const messages: ChatMessage[] = [
            {role: 'system', content: 'Be concise.'},
            {role: 'user', content: 'Read this.', image: {media_type: 'image/png', data: 'png-data'}},
        ];

        await expect(collect(provider.streamText(messages, new AbortController().signal))).resolves.toEqual(['hello ', 'world']);
        expect(url).toBe('https://provider.example/v1/chat/completions');
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key');
        expect(JSON.parse(String(init?.body))).toEqual({
            model: 'vision-model', stream: true, max_tokens: 256, temperature: 0.3,
            messages: [
                {role: 'system', content: 'Be concise.'},
                {role: 'user', content: [
                    {type: 'image_url', image_url: {url: 'data:image/png;base64,png-data', detail: 'high'}},
                    {type: 'text', text: 'Read this.'},
                ]},
            ],
        });
    });

    it('passes the caller abort signal to fetch', async () => {
        const controller = new AbortController();
        let received: AbortSignal | null | undefined;
        const provider = createOpenAiProvider(openAiSelection, async (_input, init) => {
            received = init?.signal;
            return sseResponse('data: [DONE]\n\n');
        });
        await collect(provider.streamText([{role: 'user', content: 'hi'}], controller.signal));
        expect(received).toBe(controller.signal);
    });

    it('throws a classified status for non-success responses', async () => {
        const provider = createOpenAiProvider(openAiSelection, async () => new Response('secret detail', {status: 401}));
        await expect(collect(provider.streamText([{role: 'user', content: 'hi'}], new AbortController().signal)))
            .rejects.toMatchObject({status: 401});
    });
});

describe('direct Anthropic provider', () => {
    it('separates system text, serializes PNG sources, and yields text deltas', async () => {
        let url = '';
        let init: RequestInit | undefined;
        const provider = createAnthropicProvider(anthropicSelection, async (input, request) => {
            url = input;
            init = request;
            return sseResponse('event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"hello"}}\n\nevent: message_stop\ndata: {}\n\n');
        });
        await expect(collect(provider.streamText([
            {role: 'system', content: 'First rule.'}, {role: 'system', content: 'Second rule.'},
            {role: 'user', content: 'What is this?', image: {media_type: 'image/png', data: 'png-data'}},
            {role: 'assistant', content: 'A screenshot.'},
        ], new AbortController().signal))).resolves.toEqual(['hello']);
        expect(url).toBe('https://provider.example/messages');
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('x-api-key')).toBe('anthropic-key');
        expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01');
        expect(JSON.parse(String(init?.body))).toEqual({
            model: 'claude-test', stream: true, max_tokens: 512, system: 'First rule.\n\nSecond rule.',
            messages: [
                {role: 'user', content: [
                    {type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'png-data'}},
                    {type: 'text', text: 'What is this?'},
                ]},
                {role: 'assistant', content: 'A screenshot.'},
            ],
        });
    });

    it('passes abort signals and classifies non-success responses', async () => {
        const controller = new AbortController();
        let received: AbortSignal | null | undefined;
        const provider = createAnthropicProvider(anthropicSelection, async (_input, init) => {
            received = init?.signal;
            return new Response(null, {status: 429});
        });
        await expect(collect(provider.streamText([{role: 'user', content: 'hi'}], controller.signal)))
            .rejects.toMatchObject({status: 429});
        expect(received).toBe(controller.signal);
    });
});

describe('ProviderCache', () => {
    it('reuses equivalent selections', () => {
        let created = 0;
        const cache = new ProviderCache(() => provider(`provider-${++created}`));
        expect(cache.get(openAiSelection)).toBe(cache.get({...openAiSelection}));
        expect(created).toBe(1);
    });

    it('disposes the least recently used provider when full', async () => {
        const created: ReturnType<typeof provider>[] = [];
        const cache = new ProviderCache((selection) => {
            const value = provider(selection.model);
            created.push(value);
            return value;
        }, 2);
        cache.get({...openAiSelection, model: 'one'});
        cache.get({...openAiSelection, model: 'two'});
        cache.get({...openAiSelection, model: 'one'});
        cache.get({...openAiSelection, model: 'three'});
        await Promise.resolve();
        expect(created[1].disposeCount).toBe(1);
        expect(created[0].disposeCount).toBe(0);
    });

    it('disposes every retained provider exactly once', async () => {
        const created: ReturnType<typeof provider>[] = [];
        const cache = new ProviderCache((selection) => {
            const value = provider(selection.model);
            created.push(value);
            return value;
        });
        cache.get({...openAiSelection, model: 'one'});
        cache.get({...openAiSelection, model: 'two'});
        await cache.dispose();
        await cache.dispose();
        expect(created.map((value) => value.disposeCount)).toEqual([1, 1]);
    });
});

function provider(key: string): BackendProvider & {disposeCount: number} {
    return {
        key,
        disposeCount: 0,
        async *streamText(): AsyncGenerator<string> { return; },
        async dispose() { this.disposeCount += 1; },
    };
}
