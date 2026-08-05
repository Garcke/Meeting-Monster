import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CAPTURE_MODULE = '../../desktop/dist/main/screen-capture.js';
const CAPTURE_SOURCE = new URL('../../desktop/src/main/screen-capture.ts', import.meta.url);

async function loadCaptureModule() {
    return import(CAPTURE_MODULE);
}

function fakeThumbnail({
    bytes = Buffer.from('screen-png'), width = 2048, height = 1152, empty = false, bytesForSize, resizedTo = [],
} = {}) {
    const thumbnail = {
        isEmpty: () => empty,
        getSize: () => ({width, height}),
        toPNG: () => bytesForSize ? bytesForSize(width, height) : bytes,
        resize: ({width: nextWidth, height: nextHeight}) => {
            resizedTo.push({width: nextWidth, height: nextHeight});
            return fakeThumbnail({bytes, width: nextWidth, height: nextHeight, empty, bytesForSize, resizedTo}).thumbnail;
        },
    };
    return {thumbnail, resizedTo};
}

test('keeps the capture dependency contract and implementation free of filesystem access', () => {
    const source = fs.readFileSync(CAPTURE_SOURCE, 'utf8');
    const dependencyContract = source.match(/export interface ScreenCaptureDependencies \{[\s\S]*?\n\}/)?.[0] ?? '';

    assert.match(dependencyContract, /screen:/);
    assert.match(dependencyContract, /desktopCapturer:/);
    assert.doesNotMatch(dependencyContract, /\b(?:fs|path|file|readFile|writeFile)\b/i);
    assert.doesNotMatch(source, /node:(?:fs|path)|from ['"](?:fs|path)['"]|\b(?:readFile|writeFile|appendFile|mkdir|unlink)\b/);
});

function captureDependencies({sources, display = {id: 22, size: {width: 3840, height: 2160}, scaleFactor: 1}}) {
    const calls = [];
    return {
        calls,
        dependencies: {
            screen: {
                getCursorScreenPoint: () => ({x: 2500, y: 300}),
                getDisplayNearestPoint: (point) => {
                    assert.deepEqual(point, {x: 2500, y: 300});
                    return display;
                },
            },
            desktopCapturer: {
                getSources: async (options) => {
                    calls.push(options);
                    return sources;
                },
            },
        },
    };
}

test('captures only the display nearest the cursor at the maximum long edge', async () => {
    const {captureCurrentDisplay, MAX_SCREENSHOT_LONG_EDGE} = await loadCaptureModule();
    const targetBytes = Buffer.from('target-display-png');
    const target = fakeThumbnail({bytes: targetBytes, width: 3840, height: 2160});
    const {dependencies, calls} = captureDependencies({
        sources: [
            {display_id: '11', thumbnail: fakeThumbnail({bytes: Buffer.from('wrong-display')}).thumbnail},
            {display_id: '22', thumbnail: target.thumbnail},
        ],
    });

    const result = await captureCurrentDisplay(dependencies);

    assert.deepEqual(calls, [{types: ['screen'], thumbnailSize: {width: 2048, height: 1152}}]);
    assert.equal(result.data, targetBytes.toString('base64'));
    assert.equal(result.mediaType, 'image/png');
    assert.deepEqual({width: result.width, height: result.height}, {width: 2048, height: 1152});
    assert.equal(Math.max(result.width, result.height), MAX_SCREENSHOT_LONG_EDGE);
});

test('uses display scale factor when fitting the requested thumbnail size', async () => {
    const {captureCurrentDisplay} = await loadCaptureModule();
    const {dependencies, calls} = captureDependencies({
        display: {id: 22, size: {width: 1280, height: 720}, scaleFactor: 2},
        sources: [{display_id: '22', thumbnail: fakeThumbnail({width: 2048, height: 1152}).thumbnail}],
    });

    await captureCurrentDisplay(dependencies);

    assert.deepEqual(calls, [{types: ['screen'], thumbnailSize: {width: 2048, height: 1152}}]);
});

test('rejects a missing display source or empty thumbnail', async () => {
    const {captureCurrentDisplay} = await loadCaptureModule();
    const missing = captureDependencies({
        sources: [{display_id: '11', thumbnail: fakeThumbnail().thumbnail}],
    });
    await assert.rejects(captureCurrentDisplay(missing.dependencies), /Unable to capture the current screen/);

    const empty = captureDependencies({
        sources: [{display_id: '22', thumbnail: fakeThumbnail({empty: true}).thumbnail}],
    });
    await assert.rejects(captureCurrentDisplay(empty.dependencies), /Unable to capture the current screen/);
});

test('downscales thumbnails until the PNG is within the byte limit', async () => {
    const {captureCurrentDisplay, MAX_SCREENSHOT_BYTES} = await loadCaptureModule();
    const bytesForSize = (width) => Buffer.alloc(width > 1024 ? MAX_SCREENSHOT_BYTES + 1 : 64, 7);
    const {thumbnail, resizedTo} = fakeThumbnail({width: 2048, height: 1152, bytesForSize});
    const {dependencies} = captureDependencies({sources: [{display_id: '22', thumbnail}]});

    const result = await captureCurrentDisplay(dependencies);

    assert.deepEqual(resizedTo, [
        {width: 1638, height: 921},
        {width: 1310, height: 737},
        {width: 1048, height: 590},
        {width: 1024, height: 576},
    ]);
    assert.deepEqual({width: result.width, height: result.height}, {width: 1024, height: 576});
    assert.ok(Buffer.from(result.data, 'base64').byteLength <= MAX_SCREENSHOT_BYTES);
});

test('fails when an image remains above the byte limit at the minimum allowed size', async () => {
    const {captureCurrentDisplay, MAX_SCREENSHOT_BYTES} = await loadCaptureModule();
    const {thumbnail, resizedTo} = fakeThumbnail({
        width: 2048,
        height: 1152,
        bytesForSize: () => Buffer.alloc(MAX_SCREENSHOT_BYTES + 1, 7),
    });
    const {dependencies} = captureDependencies({sources: [{display_id: '22', thumbnail}]});

    await assert.rejects(captureCurrentDisplay(dependencies), /Unable to capture the current screen/);
    assert.deepEqual(resizedTo.at(-1), {width: 1024, height: 576});
});
