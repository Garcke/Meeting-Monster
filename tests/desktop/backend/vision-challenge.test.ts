import {inflateSync} from 'node:zlib';
import {describe, expect, it} from 'vitest';
import {
    createVisionChallenge,
    extractVisionCode,
    verifyProviderVision,
    type VisionChallenge,
} from '../../../desktop/src/backend/vision-challenge';
import type {BackendProvider, ChatMessage} from '../../../desktop/src/backend/types';

describe('vision challenge generation', () => {
    it('generates four deterministic digits and a 360 by 88 PNG', () => {
        const random = sequence([0, 0.19, 0.5, 0.99]);
        const challenge = createVisionChallenge(random);
        const png = Buffer.from(challenge.image.data, 'base64');

        expect(challenge.code).toBe('0159');
        expect(challenge.image.media_type).toBe('image/png');
        expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(png.readUInt32BE(16)).toBe(360);
        expect(png.readUInt32BE(20)).toBe(88);
        expect(inflatePngIdat(png)).toHaveLength(88 * (1 + 360 * 3));
    });
});

describe('vision answer parsing', () => {
    it('accepts a JSON code response', () => {
        expect(extractVisionCode('{"code":"0123"}')).toBe('0123');
        expect(extractVisionCode('{"code":"0123","source":"vision"}')).toBe('0123');
    });

    it('accepts JSON inside a json fence', () => {
        expect(extractVisionCode('```json\n{"code":"0123"}\n```')).toBe('0123');
    });

    it('accepts exactly four bare digits', () => {
        expect(extractVisionCode('  0123  ')).toBe('0123');
    });

    it('rejects malformed JSON and non-bare digit answers', () => {
        expect(extractVisionCode('{"code":"0123"')).toBeNull();
        expect(extractVisionCode('**0123**')).toBeNull();
        expect(extractVisionCode('the code is 0123')).toBeNull();
    });

    it('rejects extra or alphanumeric-adjacent digits', () => {
        expect(extractVisionCode('01234')).toBeNull();
        expect(extractVisionCode('before0123after')).toBeNull();
        expect(extractVisionCode('A0123')).toBeNull();
        expect(extractVisionCode('0123z')).toBeNull();
    });
});

describe('provider vision verification', () => {
    it('sends the image in the fixed prompt and verifies a streamed response', async () => {
        const provider = fakeProvider(['{"code":"012', '3"}']);
        const challenge = fixture('0123');
        const signal = new AbortController().signal;

        await expect(verifyProviderVision(provider, challenge, signal)).resolves.toBe(true);
        expect(provider.messages).toEqual([{
            role: 'user',
            content: 'Read the four digits in the image. Return only JSON in this format: {"code":"1234"} Do not include explanations or other fields.',
            image: challenge.image,
        }]);
        expect(provider.signal).toBe(signal);
    });

    it('caps streamed answers at 128 characters', async () => {
        await expect(verifyProviderVision(fakeProvider(['x'.repeat(200), '0123']), fixture('0123'), new AbortController().signal))
            .resolves.toBe(false);
    });

    it('propagates an aborted request', async () => {
        const controller = new AbortController();
        controller.abort(new Error('cancelled'));
        await expect(verifyProviderVision(fakeProvider(['0123']), fixture('0123'), controller.signal))
            .rejects.toThrow('cancelled');
    });

    it('does not start provider streaming after the request is already aborted', async () => {
        const controller = new AbortController();
        const provider = fakeProvider(['0123']);
        controller.abort(new Error('cancelled'));

        await expect(verifyProviderVision(provider, fixture('0123'), controller.signal)).rejects.toThrow('cancelled');
        expect(provider.started).not.toBe(true);
    });
});

function fixture(code: string): VisionChallenge {
    return {code, image: {media_type: 'image/png', data: Buffer.from('fixture').toString('base64')}};
}

function fakeProvider(chunks: readonly string[]): BackendProvider & {messages?: readonly ChatMessage[]; signal?: AbortSignal; started?: boolean} {
    return {
        key: 'fake',
        async *streamText(messages, signal) {
            this.started = true;
            this.messages = messages;
            this.signal = signal;
            for (const chunk of chunks) {
                if (signal.aborted) throw signal.reason;
                yield chunk;
            }
        },
        async dispose() {},
    };
}

function sequence(values: readonly number[]): () => number {
    let index = 0;
    return () => values[index++] ?? 0;
}

function inflatePngIdat(png: Buffer): Buffer {
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        const type = png.toString('ascii', offset + 4, offset + 8);
        if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    return inflateSync(Buffer.concat(chunks));
}
