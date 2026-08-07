import {classifyProviderError} from '../model-diagnostics';
import {parseSse} from '../sse';
import type {BackendModelSelection, BackendProvider, ChatMessage} from '../types';
import type {BackendFetch} from './provider';

export function createAnthropicProvider(selection: BackendModelSelection, fetcher: BackendFetch = fetch): BackendProvider {
    return {
        key: providerKey(selection),
        async *streamText(messages, signal) {
            const system = messages.filter((message) => message.role === 'system' && message.content)
                .map((message) => message.content).join('\n\n');
            const response = await fetcher(endpoint(selection.base_url, 'messages'), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(selection.api_key ? {'x-api-key': selection.api_key} : {}),
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: selection.model,
                    messages: messages.filter((message) => message.role !== 'system' && message.content)
                        .map(serializeMessage),
                    stream: true,
                    max_tokens: selection.max_tokens,
                    ...(system ? {system} : {}),
                    ...(selection.temperature == null ? {} : {temperature: selection.temperature}),
                }),
                signal,
            });
            if (!response.ok) throw providerError(response.status);
            for await (const event of parseSse(response, signal)) {
                if (event.event !== 'content_block_delta') continue;
                const text = anthropicText(event.data);
                if (text) yield text;
            }
        },
        async dispose() {},
    };
}

function serializeMessage(message: ChatMessage): Record<string, unknown> {
    if (message.role === 'user' && message.image) {
        return {role: message.role, content: [
            {type: 'image', source: {type: 'base64', media_type: 'image/png', data: message.image.data}},
            {type: 'text', text: message.content},
        ]};
    }
    return {role: message.role, content: message.content};
}

function anthropicText(data: string): string | undefined {
    try {
        const parsed = JSON.parse(data) as {delta?: {type?: unknown; text?: unknown}};
        const text = parsed.delta?.text;
        return parsed.delta?.type === 'text_delta' && typeof text === 'string' && text ? text : undefined;
    } catch {
        return undefined;
    }
}

function endpoint(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/${path}`;
}

function providerKey(selection: BackendModelSelection): string {
    return JSON.stringify([selection.protocol, selection.base_url, selection.model, selection.api_key,
        selection.max_tokens, selection.temperature]);
}

function providerError(status: number): Error & {status: number} {
    const diagnostic = classifyProviderError({status});
    return Object.assign(new Error(diagnostic.message), {status});
}
