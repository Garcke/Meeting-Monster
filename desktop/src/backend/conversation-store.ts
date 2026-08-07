import type {BackendImage, ChatMessage} from './types';

/** Owns the one-user in-memory chat transcript. */
export class ConversationStore {
    private messages: ChatMessage[] = [];

    constructor(initialSystemPrompt?: string) {
        if (initialSystemPrompt !== undefined) this.setPrompt(initialSystemPrompt);
    }

    setPrompt(prompt: string): void {
        this.messages = [
            {role: 'system', content: prompt},
            ...this.messages.filter((message) => message.role !== 'system'),
        ];
    }

    reset(): void {
        this.messages = [];
    }

    snapshot(): readonly ChatMessage[] {
        return this.messages.map(cloneMessage);
    }

    appendUser(content: string, image?: BackendImage): readonly ChatMessage[] {
        this.messages.push({role: 'user', content});
        const outbound = this.snapshot() as ChatMessage[];
        if (image) outbound[outbound.length - 1] = {role: 'user', content, image: cloneImage(image)};
        return outbound;
    }

    commitAssistant(content: string): void {
        if (this.messages.at(-1)?.role !== 'user') return;
        this.messages.push({role: 'assistant', content});
    }
}

function cloneMessage(message: ChatMessage): ChatMessage {
    return {...message, ...(message.image ? {image: cloneImage(message.image)} : {})};
}

function cloneImage(image: BackendImage): BackendImage {
    return {media_type: 'image/png', data: image.data};
}
