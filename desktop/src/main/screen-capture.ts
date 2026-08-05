export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_SCREENSHOT_LONG_EDGE = 2048;

const MIN_SCREENSHOT_LONG_EDGE = 1024;
const CAPTURE_ERROR = 'Unable to capture the current screen';

export interface CapturedScreenImage {
    mediaType: 'image/png';
    data: string;
    width: number;
    height: number;
}

export interface ScreenPoint {
    x: number;
    y: number;
}

export interface ScreenSize {
    width: number;
    height: number;
}

export interface ScreenDisplay {
    id: number;
    size: ScreenSize;
    scaleFactor: number;
}

export interface ScreenThumbnail {
    isEmpty(): boolean;
    getSize(): ScreenSize;
    toPNG(): Uint8Array;
    resize(size: ScreenSize): ScreenThumbnail;
}

export interface ScreenCaptureSource {
    display_id: string;
    thumbnail: ScreenThumbnail;
}

export interface ScreenCaptureDependencies {
    screen: {
        getCursorScreenPoint(): ScreenPoint;
        getDisplayNearestPoint(point: ScreenPoint): ScreenDisplay;
    };
    desktopCapturer: {
        getSources(options: {types: ['screen']; thumbnailSize: ScreenSize}): Promise<ScreenCaptureSource[]>;
    };
}

export async function captureCurrentDisplay(
    dependencies: ScreenCaptureDependencies,
): Promise<CapturedScreenImage> {
    try {
        const point = dependencies.screen.getCursorScreenPoint();
        const display = dependencies.screen.getDisplayNearestPoint(point);
        const target = fitWithinLongEdge(display.size, display.scaleFactor, MAX_SCREENSHOT_LONG_EDGE);
        const sources = await dependencies.desktopCapturer.getSources({types: ['screen'], thumbnailSize: target});
        const source = sources.find((item) => item.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty()) throw new Error(CAPTURE_ERROR);
        return encodeWithinLimit(source.thumbnail, target, MAX_SCREENSHOT_BYTES);
    } catch {
        throw new Error(CAPTURE_ERROR);
    }
}

function fitWithinLongEdge(size: ScreenSize, scaleFactor: number, maximumLongEdge: number): ScreenSize {
    if (!isPositiveSize(size) || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
        throw new Error(CAPTURE_ERROR);
    }
    const scaled = {
        width: Math.max(1, Math.round(size.width * scaleFactor)),
        height: Math.max(1, Math.round(size.height * scaleFactor)),
    };
    return resizeToLongEdge(scaled, maximumLongEdge);
}

function encodeWithinLimit(
    original: ScreenThumbnail,
    target: ScreenSize,
    maximumBytes: number,
): CapturedScreenImage {
    let thumbnail = resizeIfNeeded(original, target);
    while (true) {
        const size = thumbnail.getSize();
        if (!isPositiveSize(size)) throw new Error(CAPTURE_ERROR);
        const png = thumbnail.toPNG();
        if (png.byteLength <= maximumBytes) {
            return {
                mediaType: 'image/png',
                data: Buffer.from(png).toString('base64'),
                width: size.width,
                height: size.height,
            };
        }
        if (Math.max(size.width, size.height) <= MIN_SCREENSHOT_LONG_EDGE) {
            throw new Error(CAPTURE_ERROR);
        }
        thumbnail = thumbnail.resize(resizeToLongEdge(size, Math.max(
            MIN_SCREENSHOT_LONG_EDGE,
            Math.floor(Math.max(size.width, size.height) * 0.8),
        )));
    }
}

function resizeIfNeeded(thumbnail: ScreenThumbnail, target: ScreenSize): ScreenThumbnail {
    const size = thumbnail.getSize();
    if (size.width === target.width && size.height === target.height) return thumbnail;
    return thumbnail.resize(target);
}

function resizeToLongEdge(size: ScreenSize, maximumLongEdge: number): ScreenSize {
    const longEdge = Math.max(size.width, size.height);
    if (longEdge <= maximumLongEdge) return {...size};
    const scale = maximumLongEdge / longEdge;
    return {
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
    };
}

function isPositiveSize(size: ScreenSize): boolean {
    return Number.isFinite(size.width)
        && Number.isFinite(size.height)
        && size.width > 0
        && size.height > 0;
}
