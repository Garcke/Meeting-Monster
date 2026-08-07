export interface SseEvent {
    event: string;
    data: string;
}

/** Parse a response body according to the SSE line and blank-line framing rules. */
export async function* parseSse(response: Response, signal: AbortSignal): AsyncGenerator<SseEvent> {
    if (signal.aborted || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let eventName = 'message';
    let dataLines: string[] = [];

    const dispatch = (): SseEvent | undefined => {
        if (!dataLines.length) return undefined;
        const event = {event: eventName, data: dataLines.join('\n')};
        eventName = 'message';
        dataLines = [];
        return event;
    };

    const readLine = (): string | undefined => {
        const newline = buffered.indexOf('\n');
        if (newline < 0) return undefined;
        const line = buffered.slice(0, newline).replace(/\r$/, '');
        buffered = buffered.slice(newline + 1);
        return line;
    };

    const consume = function* (): Generator<SseEvent> {
        while (!signal.aborted) {
            const line = readLine();
            if (line === undefined) return;
            if (!line) {
                const event = dispatch();
                if (event) yield event;
                continue;
            }
            if (line.startsWith(':')) continue;
            const separator = line.indexOf(':');
            const field = separator < 0 ? line : line.slice(0, separator);
            const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
            if (field === 'event') eventName = value;
            if (field === 'data') dataLines.push(value);
        }
    };

    try {
        while (!signal.aborted) {
            const {done, value} = await readWithAbort(reader, signal);
            if (signal.aborted || done) break;
            if (value) buffered += decoder.decode(value, {stream: true});
            for (const event of consume()) yield event;
        }
        if (!signal.aborted) {
            buffered += decoder.decode();
            for (const event of consume()) yield event;
        }
    } finally {
        if (signal.aborted) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

async function readWithAbort(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (signal.aborted) return {done: true, value: undefined};
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        onAbort = () => {
            void reader.cancel().catch(() => undefined);
            resolve({done: true, value: undefined});
        };
        signal.addEventListener('abort', onAbort, {once: true});
    });
    try {
        return await Promise.race([reader.read(), aborted]);
    } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
    }
}
