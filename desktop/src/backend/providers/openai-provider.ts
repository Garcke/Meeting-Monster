import OpenAI from 'openai';
import type {ChatCompletionMessageParam} from 'openai/resources/chat/completions';
import type {BackendModelSelection, BackendProvider, ChatMessage} from '../types';
import type {BackendFetch} from './provider';

type OpenAiClientConstructor = new (options: ConstructorParameters<typeof OpenAI>[0]) => Pick<OpenAI, 'chat'>;

export function createOpenAiProvider(
    selection: BackendModelSelection,
    fetcher: BackendFetch = fetch,
    OpenAiClient: OpenAiClientConstructor = OpenAI,
): BackendProvider {
    return {
        key: providerKey(selection),
        async *streamText(messages, signal) {
            const client = new OpenAiClient({
                apiKey: selection.api_key || 'unused',
                baseURL: selection.base_url,
                fetch: fetcher as typeof fetch,
                maxRetries: 0,
            });
            const stream = await client.chat.completions.create({
                model: selection.model,
                messages: messages.map(serializeMessage),
                max_tokens: selection.max_tokens,
                ...(selection.temperature == null ? {} : {temperature: selection.temperature}),
                stream: true,
            }, {signal});
            for await (const chunk of stream) {
                const text = chunk.choices[0]?.delta?.content;
                if (text) yield text;
            }
        },
        async dispose() {},
    };
}

function serializeMessage(message: ChatMessage): ChatCompletionMessageParam {
    if (message.role === 'user' && message.image) {
        return {role: message.role, content: [
            {type: 'image_url', image_url: {url: `data:${message.image.media_type};base64,${message.image.data}`, detail: 'high'}},
            {type: 'text', text: message.content},
        ]};
    }
    return {role: message.role, content: message.content};
}

function providerKey(selection: BackendModelSelection): string {
    return JSON.stringify([selection.protocol, selection.base_url, selection.model, selection.api_key,
        selection.max_tokens, selection.temperature]);
}
