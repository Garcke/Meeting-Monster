import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SETTINGS_MODULE = '../../desktop/dist/main/model-connection-settings.js';

function fakeSafeStorage({available = true, onDecrypt = () => {}} = {}) {
    return {
        isEncryptionAvailable: () => available,
        encryptString(value) { return Buffer.from(`encrypted:${value}`, 'utf8'); },
        decryptString(value) {
            onDecrypt();
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

function openAiConnection(overrides = {}) {
    return {
        profile_id: 'generic_openai',
        protocol: 'openai',
        base_url: 'https://api.openai.example/v1',
        model: 'gpt-example',
        api_key: 'openai-secret',
        max_tokens: 2048,
        temperature: 0.4,
        ...overrides,
    };
}

function anthropicConnection(overrides = {}) {
    return {
        profile_id: 'generic_anthropic',
        protocol: 'anthropic',
        base_url: 'https://api.anthropic.example',
        model: 'claude-example',
        api_key: 'anthropic-secret',
        max_tokens: 4096,
        temperature: 0.2,
        ...overrides,
    };
}

test('version-2 store retains OpenAI and Anthropic connections independently', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });

    assert.deepEqual(await store.loadSummary(), {
        active_profile: 'generic_openai',
        connections: {},
    });
    await store.saveConnection(openAiConnection());
    const summary = await store.saveConnection(anthropicConnection());

    assert.deepEqual(summary, {
        active_profile: 'generic_anthropic',
        connections: {
            generic_openai: {
                profile_id: 'generic_openai',
                protocol: 'openai',
                base_url: 'https://api.openai.example/v1',
                model: 'gpt-example',
                has_api_key: true,
                max_tokens: 2048,
                temperature: 0.4,
            },
            generic_anthropic: {
                profile_id: 'generic_anthropic',
                protocol: 'anthropic',
                base_url: 'https://api.anthropic.example',
                model: 'claude-example',
                has_api_key: true,
                max_tokens: 4096,
                temperature: 0.2,
            },
        },
    });
    assert.deepEqual(await store.loadSettings(), {
        active_profile: 'generic_anthropic',
        connections: {
            generic_openai: openAiConnection(),
            generic_anthropic: anthropicConnection(),
        },
    });

    const raw = fs.readFileSync(temporary.file, 'utf8');
    assert.equal(JSON.parse(raw).version, 2);
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['encryptedConnection', 'version']);
    assert.doesNotMatch(
        raw,
        /openai-secret|anthropic-secret|generic_openai|generic_anthropic|api\.openai|api\.anthropic|gpt-example|claude-example/,
    );
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('saving one protocol updates it without overwriting the other protocol', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });
    await store.saveConnection(openAiConnection());
    await store.saveConnection(anthropicConnection());

    await store.saveConnection(openAiConnection({
        model: 'gpt-updated',
        api_key: 'updated-openai-secret',
        max_tokens: 8192,
    }));

    assert.deepEqual(await store.loadSettings(), {
        active_profile: 'generic_openai',
        connections: {
            generic_openai: openAiConnection({
                model: 'gpt-updated',
                api_key: 'updated-openai-secret',
                max_tokens: 8192,
            }),
            generic_anthropic: anthropicConnection(),
        },
    });
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('empty API key is retained only for an identical connection identity', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });
    await store.saveConnection(openAiConnection());

    await store.saveConnection(openAiConnection({api_key: '', max_tokens: 1024}));
    assert.equal(
        (await store.loadSettings()).connections.generic_openai.api_key,
        'openai-secret',
    );

    await store.saveConnection(openAiConnection({
        base_url: 'https://other-openai.example/v1',
        api_key: '',
    }));
    assert.equal(
        (await store.loadSettings()).connections.generic_openai.api_key,
        undefined,
    );

    await store.saveConnection(openAiConnection({api_key: 'replacement-secret'}));
    await store.saveConnection(openAiConnection({model: 'gpt-other', api_key: ''}));
    assert.equal(
        (await store.loadSettings()).connections.generic_openai.api_key,
        undefined,
    );

    await store.saveConnection(openAiConnection({api_key: 'openai-again'}));
    await store.saveConnection(anthropicConnection({api_key: ''}));
    assert.equal(
        (await store.loadSettings()).connections.generic_anthropic.api_key,
        undefined,
    );
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('version-1 settings are stale and are cleared without decrypting or reusing their key', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    fs.writeFileSync(temporary.file, JSON.stringify({
        version: 1,
        encryptedConnection: Buffer.from('legacy-ciphertext').toString('base64'),
    }));
    fs.writeFileSync(`${temporary.file}.tmp`, 'legacy-temporary-data');
    let decryptCalls = 0;
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage({onDecrypt: () => { decryptCalls += 1; }}),
        settingsPath: temporary.file,
    });

    assert.deepEqual(await store.loadSummary(), {
        active_profile: 'generic_openai',
        connections: {},
    });
    assert.equal(decryptCalls, 0);
    assert.equal(fs.existsSync(temporary.file), false);
    assert.equal(fs.existsSync(`${temporary.file}.tmp`), false);

    const saved = await store.saveConnection(openAiConnection({api_key: ''}));
    assert.equal(saved.connections.generic_openai.has_api_key, false);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('connection validation rejects mismatches, malformed values, and unknown fields', async (t) => {
    const {validateModelConnection} = await import(SETTINGS_MODULE);
    const invalidConnections = [
        ['unknown profile ID', openAiConnection({profile_id: 'other_openai'})],
        ['profile/protocol mismatch', openAiConnection({protocol: 'anthropic'})],
        ['invalid Base URL', openAiConnection({base_url: 'file:///tmp/model'})],
        ['Base URL query', openAiConnection({base_url: 'https://api.example/v1?key=secret'})],
        ['empty Model ID', openAiConnection({model: '  '})],
        ['missing Token count', (() => {
            const value = openAiConnection();
            delete value.max_tokens;
            return value;
        })()],
        ['zero Token count', openAiConnection({max_tokens: 0})],
        ['fractional Token count', openAiConnection({max_tokens: 1.5})],
        ['low temperature', openAiConnection({temperature: -0.01})],
        ['high temperature', openAiConnection({temperature: 2.01})],
        ['unknown field', openAiConnection({settings_path: 'C:\\secret', access_token: 'leak'})],
    ];

    for (const [name, connection] of invalidConnections) {
        await t.test(name, () => {
            assert.throws(() => validateModelConnection(connection), /invalid|unsupported|required/i);
        });
    }
});

test('summary exposes required connection metadata and no secret-bearing fields', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });

    const summary = await store.saveConnection(openAiConnection());
    assert.deepEqual(
        Object.keys(summary.connections.generic_openai).sort(),
        ['base_url', 'has_api_key', 'max_tokens', 'model', 'profile_id', 'protocol', 'temperature'],
    );
    const serialized = JSON.stringify(summary);
    assert.doesNotMatch(serialized, /openai-secret|["']api_key["']|encryptedConnection|settingsPath|\.tmp/i);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('store keeps atomic writes and refuses plaintext fallback without safeStorage', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const writes = [];
    const renames = [];
    const fileSystem = {
        readFile: fs.promises.readFile,
        mkdir: fs.promises.mkdir,
        unlink: fs.promises.unlink,
        writeFile: async (...args) => {
            writes.push(args[0]);
            return fs.promises.writeFile(...args);
        },
        rename: async (...args) => {
            renames.push(args.slice(0, 2));
            return fs.promises.rename(...args);
        },
    };
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file, fileSystem,
    });

    await store.saveConnection(openAiConnection());
    assert.deepEqual(writes, [`${temporary.file}.tmp`]);
    assert.deepEqual(renames, [[`${temporary.file}.tmp`, temporary.file]]);

    const unavailablePath = path.join(temporary.directory, 'unavailable.json');
    const unavailableStore = new ModelConnectionStore({
        safeStorage: fakeSafeStorage({available: false}), settingsPath: unavailablePath,
    });
    await assert.rejects(
        unavailableStore.saveConnection(openAiConnection()),
        /encryption/i,
    );
    assert.equal(fs.existsSync(unavailablePath), false);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('temporary safeStorage unavailability does not delete an existing encrypted settings file', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const availableStore = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });
    await availableStore.saveConnection(openAiConnection());
    const before = fs.readFileSync(temporary.file);

    const unavailableStore = new ModelConnectionStore({
        safeStorage: fakeSafeStorage({available: false}), settingsPath: temporary.file,
    });
    await assert.rejects(unavailableStore.saveConnection(anthropicConnection()), /encryption/i);
    assert.deepEqual(fs.readFileSync(temporary.file), before);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});
