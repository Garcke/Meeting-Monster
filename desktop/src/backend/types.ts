export type BackendProtocol = 'openai' | 'anthropic';
export type BackendProfileId = 'generic_openai' | 'generic_anthropic';

export interface BackendModelSelection {
    profile_id: BackendProfileId;
    protocol: BackendProtocol;
    base_url: string;
    model: string;
    api_key?: string;
    max_tokens: number;
    temperature?: number | null;
}

export interface BackendImage {
    media_type: 'image/png';
    data: string;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    image?: BackendImage;
}

export type BackendChatEvent =
    | {type: 'chunk'; text: string}
    | {type: 'error'; text: string}
    | {type: 'done'};

export interface BackendProvider {
    readonly key: string;
    streamText(messages: readonly ChatMessage[], signal: AbortSignal): AsyncGenerator<string>;
    dispose(): Promise<void>;
}
