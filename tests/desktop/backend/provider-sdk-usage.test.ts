import {describe, expect, it, vi} from 'vitest';
import {createAnthropicProvider} from '../../../desktop/src/backend/providers/anthropic-provider';
import {createOpenAiProvider} from '../../../desktop/src/backend/providers/openai-provider';
import type {BackendModelSelection} from '../../../desktop/src/backend/types';

const sdk = vi.hoisted(() => ({
    openAiConstructor: vi.fn(),
    openAiCreate: vi.fn(),
    anthropicConstructor: vi.fn(),
    anthropicStream: vi.fn(),
}));

const OpenAiClient = vi.fn(function (options: unknown) {
    sdk.openAiConstructor(options);
    return {chat: {completions: {create: sdk.openAiCreate}}};
});

const AnthropicClient = vi.fn(function (options: unknown) {
    sdk.anthropicConstructor(options);
    return {messages: {stream: sdk.anthropicStream}};
});

const openAiSelection: BackendModelSelection = {
    profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://provider.example/v1',
    model: 'openai-model', api_key: 'openai-key', max_tokens: 256, temperature: 0.3,
};
const anthropicSelection: BackendModelSelection = {
    profile_id: 'generic_anthropic', protocol: 'anthropic', base_url: 'https://provider.example/anthropic/v1/',
    model: 'claude-model', api_key: 'anthropic-key', max_tokens: 512, temperature: null,
};

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
}

async function* openAiStream(): AsyncGenerator<{choices: Array<{delta: {content?: string}}>}> {
    yield {choices: [{delta: {content: 'hello'}}]};
    yield {choices: [{delta: {content: ' world'}}]};
}

async function* anthropicStream(): AsyncGenerator<{
    type: 'content_block_delta';
    delta: {type: 'text_delta'; text: string};
}> {
    yield {type: 'content_block_delta', delta: {type: 'text_delta', text: 'hello'}};
    yield {type: 'content_block_delta', delta: {type: 'text_delta', text: ' world'}};
}

describe('provider SDK usage guard', () => {
    it('uses the OpenAI client constructor and streaming completion API', async () => {
        sdk.openAiCreate.mockResolvedValue(openAiStream());
        const fetcher = vi.fn();
        const signal = new AbortController().signal;

        await expect(collect(createOpenAiProvider(openAiSelection, fetcher, OpenAiClient as never)
            .streamText([{role: 'user', content: 'hi'}], signal)))
            .resolves.toEqual(['hello', ' world']);

        expect(sdk.openAiConstructor).toHaveBeenCalledWith(expect.objectContaining({
            apiKey: 'openai-key', baseURL: 'https://provider.example/v1', fetch: fetcher,
        }));
        expect(sdk.openAiCreate).toHaveBeenCalledWith(expect.objectContaining({
            model: 'openai-model', max_tokens: 256, temperature: 0.3, stream: true,
            messages: [{role: 'user', content: 'hi'}],
        }), {signal});
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('uses the Anthropic client constructor and text stream API', async () => {
        sdk.anthropicStream.mockReturnValue(anthropicStream());
        const fetcher = vi.fn();
        const signal = new AbortController().signal;

        await expect(collect(createAnthropicProvider(anthropicSelection, fetcher, AnthropicClient as never).streamText([
            {role: 'system', content: 'Be concise.'}, {role: 'user', content: 'hi'},
        ], signal))).resolves.toEqual(['hello', ' world']);

        expect(sdk.anthropicConstructor).toHaveBeenCalledWith(expect.objectContaining({
            apiKey: 'anthropic-key', baseURL: 'https://provider.example/anthropic', fetch: fetcher,
        }));
        expect(sdk.anthropicStream).toHaveBeenCalledWith(expect.objectContaining({
            model: 'claude-model', max_tokens: 512, system: 'Be concise.',
            messages: [{role: 'user', content: 'hi'}],
        }), {signal});
        expect(fetcher).not.toHaveBeenCalled();
    });
});
