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
        assert.equal(await (await createStore('win32')).store.load(), 'mixed');
        assert.equal(await (await createStore('darwin')).store.load(), 'microphone');
    });
});

test('keeps a valid saved Windows system preference authoritative', async () => {
    const {store, file} = await createStore('win32');
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, JSON.stringify({version: 1, mode: 'system'}), 'utf8');

    assert.equal(await store.load(), 'system');
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
    assert.equal(await store.load(), 'mixed');
});

test('serializes concurrent saves with unique temporary files so the last request wins', async () => {
    const files = new Map();
    const writes = [];
    const renames = [];
    let releaseFirstWrite;
    const firstWriteGate = new Promise((resolve) => { releaseFirstWrite = resolve; });
    const file = path.join('C:', 'settings', 'audio-input.json');
    const fileSystem = {
        async readFile(target) {
            if (!files.has(target)) throw new Error('missing');
            return files.get(target);
        },
        async mkdir() {},
        async writeFile(target, contents) {
            writes.push({target, contents: String(contents)});
            if (writes.length === 1) await firstWriteGate;
            files.set(target, String(contents));
        },
        async rename(source, destination) {
            if (!files.has(source)) throw new Error('missing temporary file');
            renames.push({source, destination});
            files.set(destination, files.get(source));
            files.delete(source);
        },
        async unlink(target) { files.delete(target); },
    };
    const {AudioInputSettingsStore} = await import(SETTINGS_MODULE);
    const store = new AudioInputSettingsStore({platform: 'win32', settingsPath: file, fileSystem});

    const first = store.save('mixed');
    const second = store.save('microphone');
    await new Promise((resolve) => setImmediate(resolve));
    const writesBeforeFirstCompletes = writes.length;
    releaseFirstWrite();
    const results = await Promise.all([first, second]);

    assert.equal(writesBeforeFirstCompletes, 1);
    assert.deepEqual(results, ['mixed', 'microphone']);
    assert.equal(writes.length, 2);
    assert.notEqual(writes[0].target, writes[1].target);
    assert.deepEqual(renames.map(({destination}) => destination), [file, file]);
    assert.equal(await store.load(), 'microphone');
});
