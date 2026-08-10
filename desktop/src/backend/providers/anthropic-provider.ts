import Anthropic from '@anthropic-ai/sdk';
import type {BackendModelSelection, BackendProvider, ChatMessage} from '../types';
import type {BackendFetch} from './provider';

type AnthropicClientConstructor = new (options: ConstructorParameters<typeof Anthropic>[0]) => Pick<Anthropic, 'messages'>;

export function createAnthropicProvider(
    selection: BackendModelSelection,
    fetcher: BackendFetch = fetch,
    AnthropicClient: AnthropicClientConstructor = Anthropic,
): BackendProvider {
    return {
        key: providerKey(selection),
        async *streamText(messages, signal) {
            if (signal.aborted) throw abortError();
            const system = messages.filter((message) => message.role === 'system' && message.content)
                .map((message) => message.content).join('\n\n');
            const client = new AnthropicClient({
                apiKey: selection.api_key || 'unused',
                baseURL: normalizeBaseUrl(selection.base_url),
                fetch: fetcher as typeof fetch,
                maxRetries: 0,
            });
            const stream = client.messages.stream({
                model: selection.model,
                max_tokens: selection.max_tokens,
                messages: messages.filter((message) => message.role !== 'system' && message.content)
                    .map(serializeMessage),
                ...(system ? {system} : {}),
                ...(selection.temperature == null ? {} : {temperature: selection.temperature}),
            }, {signal});
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
                    yield event.delta.text;
                }
            }
        },
        async dispose() {},
    };
}

function serializeMessage(message: ChatMessage): Anthropic.MessageParam {
    if (message.role === 'user' && message.image) {
        return {role: message.role, content: [
            {type: 'image', source: {type: 'base64', media_type: message.image.media_type, data: message.image.data}},
            {type: 'text', text: message.content},
        ]};
    }
    return {role: message.role as 'user' | 'assistant', content: message.content};
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function abortError(): Error {
    return Object.assign(new Error('Request was aborted.'), {name: 'AbortError'});
}

function providerKey(selection: BackendModelSelection): string {
    return JSON.stringify([selection.protocol, selection.base_url, selection.model, selection.api_key,
        selection.max_tokens, selection.temperature]);
}
