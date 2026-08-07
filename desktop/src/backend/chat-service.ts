import {sanitizeProviderError} from './model-diagnostics';
import {ConversationStore} from './conversation-store';
import type {ProviderCache} from './providers/provider-cache';
import type {BackendChatEvent, BackendImage, BackendModelSelection} from './types';

export interface ChatServiceOptions {
    providers: ProviderCache;
    history?: ConversationStore;
}

/** Streams one user conversation at a time, preserving a coherent transcript. */
export class ChatService {
    private readonly history: ConversationStore;
    private turnTail: Promise<void> = Promise.resolve();
    private disposed = false;

    constructor(private readonly options: ChatServiceOptions) {
        this.history = options.history ?? new ConversationStore();
    }

    async *stream(
        content: string,
        selection: BackendModelSelection,
        signal: AbortSignal,
        image?: BackendImage,
    ): AsyncGenerator<BackendChatEvent> {
        const leave = await this.enterConversation();
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            leave();
        };
        try {
            if (this.disposed) throw new Error('ChatService is disposed');
            if (signal.aborted) return;

            const messages = this.history.appendUser(content.trim(), image);
            const provider = this.options.providers.get(selection);
            let assistant = '';
            for await (const text of provider.streamText(messages, signal)) {
                if (signal.aborted) return;
                if (!text) continue;
                assistant += text;
                yield {type: 'chunk', text};
            }
            if (signal.aborted) return;
            if (assistant) this.history.commitAssistant(assistant);
            release();
            yield {type: 'done'};
        } catch (error) {
            if (signal.aborted) return;
            yield {type: 'error', text: sanitizeProviderError(error, selection, image)};
            release();
            yield {type: 'done'};
        } finally {
            release();
        }
    }

    reset(): void {
        this.history.reset();
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        await this.options.providers.dispose();
    }

    private async enterConversation(): Promise<() => void> {
        const previous = this.turnTail;
        let release: (() => void) | undefined;
        this.turnTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        return () => release?.();
    }
}
