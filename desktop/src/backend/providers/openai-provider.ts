import {classifyProviderError} from '../model-diagnostics';
import {parseSse} from '../sse';
import type {BackendModelSelection, BackendProvider, ChatMessage} from '../types';
import type {BackendFetch} from './provider';

export function createOpenAiProvider(selection: BackendModelSelection, fetcher: BackendFetch = fetch): BackendProvider {
    return {
        key: providerKey(selection),
        async *streamText(messages, signal) {
            const response = await fetcher(endpoint(selection.base_url, 'chat/completions'), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(selection.api_key ? {authorization: `Bearer ${selection.api_key}`} : {}),
                },
                body: JSON.stringify({
                    model: selection.model,
                    messages: messages.map(serializeMessage),
                    stream: true,
                    max_tokens: selection.max_tokens,
                    ...(selection.temperature == null ? {} : {temperature: selection.temperature}),
                }),
                signal,
            });
            if (!response.ok) throw providerError(response.status);
            for await (const event of parseSse(response, signal)) {
                if (event.data === '[DONE]') return;
                const text = openAiText(event.data);
                if (text) yield text;
            }
        },
        async dispose() {},
    };
}

function serializeMessage(message: ChatMessage): Record<string, unknown> {
    if (message.role === 'user' && message.image) {
        return {role: message.role, content: [
            {type: 'image_url', image_url: {url: `data:image/png;base64,${message.image.data}`, detail: 'high'}},
            {type: 'text', text: message.content},
        ]};
    }
    return {role: message.role, content: message.content};
}

function openAiText(data: string): string | undefined {
    try {
        const parsed = JSON.parse(data) as {choices?: Array<{delta?: {content?: unknown}}>};
        const text = parsed.choices?.[0]?.delta?.content;
        return typeof text === 'string' && text ? text : undefined;
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
