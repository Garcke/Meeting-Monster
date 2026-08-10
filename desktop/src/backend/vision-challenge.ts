import {deflateSync} from 'node:zlib';
import type {BackendImage, BackendProvider, ChatMessage} from './types';

const WIDTH = 360;
const HEIGHT = 88;
const MAX_ANSWER_CHARS = 128;
const DIGITS = '0123456789';
const VISION_PROMPT = 'Read the four digits in the image. Return only JSON in this format: {"code":"1234"} Do not include explanations or other fields.';

const BITMAPS: Record<string, readonly string[]> = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'],
};

export interface VisionChallenge {
    code: string;
    image: BackendImage;
}

export function createVisionChallenge(random: () => number = Math.random): VisionChallenge {
    const code = Array.from({length: 4}, () => DIGITS[Math.min(9, Math.max(0, Math.floor(random() * 10)))]).join('');
    return {code, image: {media_type: 'image/png', data: renderCode(code).toString('base64')}};
}

export function extractVisionCode(answer: string): string | null {
    const normalized = answer.normalize('NFKC').trim();
    if (!normalized) return null;

    const jsonCandidate = unfenceJson(normalized);
    if (jsonCandidate !== null || normalized.startsWith('{')) {
        try {
            const parsed: unknown = JSON.parse(jsonCandidate ?? normalized);
            return isCodeObject(parsed) ? parsed.code : null;
        } catch {
            return null;
        }
    }

    return /^[0-9]{4}$/.test(normalized) ? normalized : null;
}

export async function verifyProviderVision(provider: BackendProvider, challenge: VisionChallenge, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) throw signal.reason;
    let answer = '';
    const messages: ChatMessage[] = [{role: 'user', content: VISION_PROMPT, image: challenge.image}];
    for await (const chunk of provider.streamText(messages, signal)) {
        if (signal.aborted) throw signal.reason;
        if (!chunk) continue;
        const remaining = MAX_ANSWER_CHARS - answer.length;
        if (remaining <= 0) break;
        answer += chunk.slice(0, remaining);
        if (answer.length >= MAX_ANSWER_CHARS) break;
    }
    if (signal.aborted) throw signal.reason;
    return extractVisionCode(answer) === challenge.code;
}

function isCodeObject(value: unknown): value is {code: string} {
    return typeof value === 'object' && value !== null
        && typeof (value as {code?: unknown}).code === 'string'
        && /^[0-9]{4}$/.test((value as {code: string}).code);
}

function unfenceJson(value: string): string | null {
    const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value);
    return match ? match[1] : null;
}

function renderCode(code: string): Buffer {
    const pixels = Buffer.alloc(WIDTH * HEIGHT * 3, 255);
    const scale = 10;
    const digitWidth = 3 * scale;
    const gap = 2 * scale;
    const totalWidth = code.length * digitWidth + (code.length - 1) * gap;
    const left = Math.floor((WIDTH - totalWidth) / 2);
    const top = Math.floor((HEIGHT - 5 * scale) / 2);
    for (const [index, digit] of Array.from(code).entries()) drawDigit(pixels, BITMAPS[digit], left + index * (digitWidth + gap), top, scale);
    return encodePng(pixels);
}

function drawDigit(pixels: Buffer, rows: readonly string[], left: number, top: number, scale: number): void {
    for (let row = 0; row < rows.length; row += 1) for (let column = 0; column < rows[row].length; column += 1) {
        if (rows[row][column] !== '1') continue;
        for (let y = 0; y < scale; y += 1) for (let x = 0; x < scale; x += 1) {
            const offset = ((top + row * scale + y) * WIDTH + left + column * scale + x) * 3;
            pixels[offset] = 24; pixels[offset + 1] = 28; pixels[offset + 2] = 36;
        }
    }
}

function encodePng(pixels: Buffer): Buffer {
    const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
    for (let y = 0; y < HEIGHT; y += 1) {
        const target = y * (1 + WIDTH * 3);
        raw[target] = 0;
        pixels.copy(raw, target + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4);
    header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Buffer): Buffer {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4, 4, 'ascii'); data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
    return chunk;
}

function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (const value of data) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
