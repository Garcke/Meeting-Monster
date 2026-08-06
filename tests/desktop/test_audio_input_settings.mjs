import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SETTINGS_MODULE = '../../desktop/dist/main/audio-input-settings.js';

async function createStore(platform) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-monster-audio-input-'));
    const file = path.join(directory, 'audio-input.json');
    const {AudioInputSettingsStore} = await import(SETTINGS_MODULE);
    return {store: new AudioInputSettingsStore({platform, settingsPath: file}), file};
}

test('defaults by platform when no preference exists', async () => {
    await assert.doesNotReject(async () => {
        assert.equal(await (await createStore('win32')).store.load(), 'system');
        assert.equal(await (await createStore('darwin')).store.load(), 'microphone');
    });
});

test('atomically persists a normalized Windows mode', async () => {
    const {store, file} = await createStore('win32');
    assert.equal(await store.save('mixed'), 'mixed');
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), {version: 1, mode: 'mixed'});
    assert.equal(await store.load(), 'mixed');
});

test('normalizes unsupported platform modes to microphone', async () => {
    const {store} = await createStore('darwin');
    assert.equal(await store.save('mixed'), 'microphone');
});

test('falls back safely for corrupt JSON', async () => {
    const {store, file} = await createStore('win32');
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, '{broken', 'utf8');
    assert.equal(await store.load(), 'system');
});
