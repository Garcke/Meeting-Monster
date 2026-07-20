import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SETTINGS_MODULE = '../../desktop/dist/main/model-connection-settings.js';

function fakeSafeStorage({available = true} = {}) {
    return {
        isEncryptionAvailable: () => available,
        encryptString(value) { return Buffer.from(`encrypted:${value}`, 'utf8'); },
        decryptString(value) {
            const plaintext = Buffer.from(value).toString('utf8');
            if (!plaintext.startsWith('encrypted:')) throw new Error('invalid ciphertext');
            return plaintext.slice('encrypted:'.length);
        },
    };
}

function temporarySettingsPath() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-monster-model-connection-'));
    return {directory, file: path.join(directory, 'model-connection.json')};
}

test('model connection store encrypts saved vendor credentials and exposes only a summary', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const connection = {
        profile_id: 'generic_anthropic', protocol: 'anthropic', api_key: 'anthropic-secret',
        max_tokens: 2048, temperature: 0.4,
    };
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });

    assert.deepEqual(await store.loadSummary(), null);
    assert.deepEqual(await store.saveConnection(connection), {
        profile_id: 'generic_anthropic', protocol: 'anthropic', has_api_key: true,
        max_tokens: 2048, temperature: 0.4,
    });
    const raw = fs.readFileSync(temporary.file, 'utf8');
    assert.doesNotMatch(raw, /anthropic-secret|generic_anthropic/);
    assert.deepEqual(await store.loadConnection(), connection);
    assert.deepEqual(await store.loadSummary(), {
        profile_id: 'generic_anthropic', protocol: 'anthropic', has_api_key: true,
        max_tokens: 2048, temperature: 0.4,
    });
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('model connection store refuses plaintext fallback when encryption is unavailable', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage({available: false}), settingsPath: temporary.file,
    });

    await assert.rejects(
        store.saveConnection({profile_id: 'generic_openai', protocol: 'openai'}),
        /encryption/i,
    );
    assert.equal(fs.existsSync(temporary.file), false);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});
