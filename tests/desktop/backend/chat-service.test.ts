import {describe, expect, it} from 'vitest';
import {parseBackendImage} from '../../../desktop/src/backend/chat-images';
import {ChatService} from '../../../desktop/src/backend/chat-service';
import {ConversationStore} from '../../../desktop/src/backend/conversation-store';
import {ProviderCache} from '../../../desktop/src/backend/providers/provider-cache';
import type {BackendModelSelection, BackendProvider, ChatMessage} from '../../../desktop/src/backend/types';

const selection: BackendModelSelection = {
    profile_id: 'generic_openai', protocol: 'openai', base_url: 'https://provider.example/v1',
    model: 'test-model', api_key: 'test-key', max_tokens: 128, temperature: 0,
};
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
    const values: unknown[] = [];
    for await (const value of stream) values.push(value);
    return values;
}

class FakeProvider implements BackendProvider {
    readonly received: ChatMessage[][] = [];
    disposeCount = 0;

    constructor(
        readonly key: string,
        private readonly chunks: readonly string[] = [],
        private readonly failure?: Error,
    ) {}

    async *streamText(messages: readonly ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
        this.received.push(messages.map((message) => ({...message, image: message.image && {...message.image}})));
        for (const chunk of this.chunks) {
            if (signal.aborted) return;
            yield chunk;
        }
        if (this.failure) throw this.failure;
    }

    async dispose(): Promise<void> { this.disposeCount += 1; }
}

class BlockingProvider extends FakeProvider {
    started = false;
    private releaseStream!: () => void;
    private readonly released = new Promise<void>((resolve) => { this.releaseStream = resolve; });

    constructor(key: string) { super(key, ['first']); }

    release(): void { this.releaseStream(); }

    override async *streamText(messages: readonly ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
        this.received.push(messages.map((message) => ({...message, image: message.image && {...message.image}})));
        this.started = true;
        if (signal.aborted) return;
        yield 'first';
        await this.released;
        if (!signal.aborted) yield 'second';
    }
}

describe('backend chat images', () => {
    it('accepts a complete PNG screenshot without retaining the caller object', () => {
        const input = {media_type: 'image/png', data: png};
        const image = parseBackendImage(input);
        input.data = 'changed';
        expect(image).toEqual({media_type: 'image/png', data: png});
    });

    it.each([
        [{media_type: 'image/png', data: ''}],
        [{media_type: 'image/jpeg', data: png}],
        [{media_type: 'image/png', data: png, extra: true}],
        [{media_type: 'image/png', data: 'not-base64'}],
    ])('rejects an invalid screenshot: %o', (input) => {
        expect(() => parseBackendImage(input)).toThrow(/png|image/i);
    });
});

describe('ConversationStore', () => {
    it('keeps the system prompt first and returns immutable history snapshots', () => {
        const store = new ConversationStore('System rule');
        const outbound = store.appendUser('Question', {media_type: 'image/png', data: png});
        (outbound as ChatMessage[])[0].content = 'mutated';
        ((outbound as ChatMessage[])[1].image as BackendImageLike).data = 'mutated';

        expect(store.snapshot()).toEqual([
            {role: 'system', content: 'System rule'},
            {role: 'user', content: 'Question'},
        ]);
    });

    it('commits assistant text only when requested and reset clears every message', () => {
        const store = new ConversationStore('System rule');
        store.appendUser('Question');
        store.commitAssistant('Answer');
        store.reset();
        expect(store.snapshot()).toEqual([]);
    });
});

type BackendImageLike = {data: string};

describe('ChatService', () => {
    it('appends a user message before streaming and commits a completed assistant reply', async () => {
        const provider = new FakeProvider('one', ['hello ', 'world']);
        const history = new ConversationStore('System rule');
        const service = new ChatService({providers: new ProviderCache(() => provider), history});

        await expect(collect(service.stream(' Question ', selection, new AbortController().signal,
            {media_type: 'image/png', data: png}))).resolves.toEqual([
            {type: 'chunk', text: 'hello '}, {type: 'chunk', text: 'world'}, {type: 'done'},
        ]);
        expect(provider.received).toEqual([[ 
            {role: 'system', content: 'System rule'},
            {role: 'user', content: 'Question', image: {media_type: 'image/png', data: png}},
        ]]);
        expect(history.snapshot()).toEqual([
            {role: 'system', content: 'System rule'},
            {role: 'user', content: 'Question'},
            {role: 'assistant', content: 'hello world'},
        ]);
    });

    it('emits a sanitized error then done without committing partial assistant text', async () => {
        const provider = new FakeProvider('broken', ['partial'], Object.assign(new Error('test-key leaked'), {status: 401}));
        const history = new ConversationStore();
        const service = new ChatService({providers: new ProviderCache(() => provider), history});

        const events = await collect(service.stream('Question', selection, new AbortController().signal));
        expect(events).toEqual([
            {type: 'chunk', text: 'partial'},
            {type: 'error', text: expect.not.stringContaining('test-key')}, {type: 'done'},
        ]);
        expect(history.snapshot()).toEqual([{role: 'user', content: 'Question'}]);
    });

    it('does not emit done or commit a partial reply after caller abort', async () => {
        const provider = new BlockingProvider('abort');
        const history = new ConversationStore();
        const service = new ChatService({providers: new ProviderCache(() => provider), history});
        const controller = new AbortController();
        const iterator = service.stream('Question', selection, controller.signal)[Symbol.asyncIterator]();

        await expect(iterator.next()).resolves.toEqual({done: false, value: {type: 'chunk', text: 'first'}});
        controller.abort();
        provider.release();
        await expect(iterator.next()).resolves.toEqual({done: true, value: undefined});
        expect(history.snapshot()).toEqual([{role: 'user', content: 'Question'}]);
    });

    it('keeps reset history empty when an in-flight stream finishes later', async () => {
        const provider = new BlockingProvider('reset');
        const history = new ConversationStore();
        const service = new ChatService({providers: new ProviderCache(() => provider), history});
        const iterator = service.stream('Question', selection, new AbortController().signal)[Symbol.asyncIterator]();

        await iterator.next();
        service.reset();
        provider.release();
        await iterator.next();
        await iterator.next();
        await iterator.next();
        expect(history.snapshot()).toEqual([]);
    });

    it('serializes whole conversation streams so later messages cannot mutate an active snapshot', async () => {
        const first = new BlockingProvider('first');
        const second = new FakeProvider('second', ['answer']);
        const cache = new ProviderCache((requested) => requested.model === 'first' ? first : second);
        const history = new ConversationStore();
        const service = new ChatService({providers: cache, history});
        const firstSelection = {...selection, model: 'first'};
        const secondSelection = {...selection, model: 'second'};
        const firstIterator = service.stream('one', firstSelection, new AbortController().signal)[Symbol.asyncIterator]();

        await firstIterator.next();
        const secondEvents = collect(service.stream('two', secondSelection, new AbortController().signal));
        await Promise.resolve();
        expect(second.received).toEqual([]);
        first.release();
        await firstIterator.next();
        await firstIterator.next();
        await firstIterator.next();
        await expect(secondEvents).resolves.toEqual([{type: 'chunk', text: 'answer'}, {type: 'done'}]);
        expect(second.received).toEqual([[ 
            {role: 'user', content: 'one'}, {role: 'assistant', content: 'firstsecond'}, {role: 'user', content: 'two'},
        ]]);
    });

    it('disposes the provider cache', async () => {
        const provider = new FakeProvider('one');
        const service = new ChatService({providers: new ProviderCache(() => provider)});
        await collect(service.stream('Question', selection, new AbortController().signal));
        await service.dispose();
        expect(provider.disposeCount).toBe(1);
    });
});
