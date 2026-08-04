import test from 'node:test';
import assert from 'node:assert/strict';

const CAPTURE_MODULE = '../../desktop/dist/main/screen-capture.js';

async function loadCaptureModule() {
    return import(CAPTURE_MODULE);
}

function fakeThumbnail({bytes = Buffer.from('screen-png'), width = 2048, height = 1152, empty = false, bytesForSize} = {}) {
    const resizedTo = [];
    const thumbnail = {
        isEmpty: () => empty,
        getSize: () => ({width, height}),
        toPNG: () => bytesForSize ? bytesForSize(width, height) : bytes,
        resize: ({width: nextWidth, height: nextHeight}) => {
            resizedTo.push({width: nextWidth, height: nextHeight});
            return fakeThumbnail({bytes, width: nextWidth, height: nextHeight, empty, bytesForSize}).thumbnail;
        },
    };
    return {thumbnail, resizedTo};
}

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
        display: {id: 22, size: {width: 2560, height: 1440}, scaleFactor: 1.5},
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
    const bytesForSize = (width) => Buffer.alloc(width > 1600 ? MAX_SCREENSHOT_BYTES + 1 : 64, 7);
    const {thumbnail, resizedTo} = fakeThumbnail({width: 2048, height: 1152, bytesForSize});
    const {dependencies} = captureDependencies({sources: [{display_id: '22', thumbnail}]});

    const result = await captureCurrentDisplay(dependencies);

    assert.ok(resizedTo.some(({width}) => width < 2048));
    assert.ok(Math.max(result.width, result.height) < 2048);
    assert.ok(Buffer.from(result.data, 'base64').byteLength <= MAX_SCREENSHOT_BYTES);
});

test('fails when an image remains above the byte limit at the minimum allowed size', async () => {
    const {captureCurrentDisplay, MAX_SCREENSHOT_BYTES} = await loadCaptureModule();
    const {thumbnail} = fakeThumbnail({
        width: 2048,
        height: 1152,
        bytesForSize: () => Buffer.alloc(MAX_SCREENSHOT_BYTES + 1, 7),
    });
    const {dependencies} = captureDependencies({sources: [{display_id: '22', thumbnail}]});

    await assert.rejects(captureCurrentDisplay(dependencies), /Unable to capture the current screen/);
});
