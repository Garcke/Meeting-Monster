import type {BackendImage} from './types';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Validate an in-memory PNG attachment without retaining its decoded pixels. */
export function parseBackendImage(value: unknown): BackendImage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Backend image must be an object');
    }
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => key !== 'media_type' && key !== 'data')) {
        throw new TypeError('Backend image contains an unsupported field');
    }
    if (input.media_type !== 'image/png' || typeof input.data !== 'string' || !input.data) {
        throw new TypeError('Only PNG screenshots are supported');
    }
    if (!BASE64.test(input.data)) throw new TypeError('Invalid PNG screenshot');
    const raw = Buffer.from(input.data, 'base64');
    if (raw.byteLength > MAX_IMAGE_BYTES || raw.byteLength < PNG_SIGNATURE.byteLength
        || !raw.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
        throw new TypeError('Invalid PNG screenshot');
    }
    return {media_type: 'image/png', data: input.data};
}
