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

function writeEncryptedSettings(file, version, settings) {
    const encryptedConnection = Buffer.from(
        `encrypted:${JSON.stringify(settings)}`,
        'utf8',
    ).toString('base64');
    fs.writeFileSync(file, JSON.stringify({version, encryptedConnection}));
}

test('version-2 settings load as unverified without rewriting the encrypted file', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const legacySettings = {
        active_profile: 'generic_openai',
        connections: {generic_openai: openAiConnection()},
    };
    writeEncryptedSettings(temporary.file, 2, legacySettings);
    const before = fs.readFileSync(temporary.file);
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });

    assert.deepEqual(await store.loadSummary(), {
        active_profile: 'generic_openai',
        connections: {
            generic_openai: {
                profile_id: 'generic_openai',
                protocol: 'openai',
                base_url: 'https://api.openai.example/v1',
                model: 'gpt-example',
                has_api_key: true,
                max_tokens: 2048,
                temperature: 0.4,
                vision_verified: false,
            },
        },
    });
    assert.equal(
        (await store.loadSettings()).connections.generic_openai.vision_verified,
        false,
    );
    assert.deepEqual(fs.readFileSync(temporary.file), before);
    assert.equal(JSON.parse(fs.readFileSync(temporary.file, 'utf8')).version, 2);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('trusted save writes version 3 and persists only an internally assigned verified flag', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const safeStorage = fakeSafeStorage();
    const store = new ModelConnectionStore({safeStorage, settingsPath: temporary.file});

    const summary = await store.saveVerifiedConnection(openAiConnection());
    assert.equal(summary.connections.generic_openai.vision_verified, true);
    const envelope = JSON.parse(fs.readFileSync(temporary.file, 'utf8'));
    assert.equal(envelope.version, 3);
    const plaintext = safeStorage.decryptString(Buffer.from(envelope.encryptedConnection, 'base64'));
    assert.equal(JSON.parse(plaintext).connections.generic_openai.vision_verified, true);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('model connection store exposes only the trusted save API', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    assert.equal('saveVerifiedConnection' in ModelConnectionStore.prototype, true);
    assert.equal('saveConnection' in ModelConnectionStore.prototype, false);
});

test('version-3 settings require a boolean vision capability', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    writeEncryptedSettings(temporary.file, 3, {
        active_profile: 'generic_openai',
        connections: {
            generic_openai: {...openAiConnection(), vision_verified: 'yes'},
        },
    });
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });

    await assert.rejects(store.loadSettings(), /could not be decrypted/i);
    assert.equal(fs.existsSync(temporary.file), false);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('version-3 store retains verified OpenAI and Anthropic connections independently', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });

    assert.deepEqual(await store.loadSummary(), {
        active_profile: 'generic_openai',
        connections: {},
    });
    await store.saveVerifiedConnection(openAiConnection());
    const summary = await store.saveVerifiedConnection(anthropicConnection());

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
                vision_verified: true,
            },
            generic_anthropic: {
                profile_id: 'generic_anthropic',
                protocol: 'anthropic',
                base_url: 'https://api.anthropic.example',
                model: 'claude-example',
                has_api_key: true,
                max_tokens: 4096,
                temperature: 0.2,
                vision_verified: true,
            },
        },
    });
    assert.deepEqual(await store.loadSettings(), {
        active_profile: 'generic_anthropic',
        connections: {
            generic_openai: {...openAiConnection(), vision_verified: true},
            generic_anthropic: {...anthropicConnection(), vision_verified: true},
        },
    });

    const raw = fs.readFileSync(temporary.file, 'utf8');
    assert.equal(JSON.parse(raw).version, 3);
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
    await store.saveVerifiedConnection(openAiConnection());
    await store.saveVerifiedConnection(anthropicConnection());

    await store.saveVerifiedConnection(openAiConnection({
        model: 'gpt-updated',
        api_key: 'updated-openai-secret',
        max_tokens: 8192,
    }));

    assert.deepEqual(await store.loadSettings(), {
        active_profile: 'generic_openai',
        connections: {
            generic_openai: {...openAiConnection({
                model: 'gpt-updated',
                api_key: 'updated-openai-secret',
                max_tokens: 8192,
            }), vision_verified: true},
            generic_anthropic: {...anthropicConnection(), vision_verified: true},
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
    await store.saveVerifiedConnection(openAiConnection());

    await store.saveVerifiedConnection(openAiConnection({api_key: '', max_tokens: 1024}));
    assert.equal(
        (await store.loadSettings()).connections.generic_openai.api_key,
        'openai-secret',
    );

    await store.saveVerifiedConnection(openAiConnection({
        base_url: 'https://other-openai.example/v1',
        api_key: '',
    }));
    assert.equal(
        (await store.loadSettings()).connections.generic_openai.api_key,
        undefined,
    );

    await store.saveVerifiedConnection(openAiConnection({api_key: 'replacement-secret'}));
    await store.saveVerifiedConnection(openAiConnection({model: 'gpt-other', api_key: ''}));
    assert.equal(
        (await store.loadSettings()).connections.generic_openai.api_key,
        undefined,
    );

    await store.saveVerifiedConnection(openAiConnection({api_key: 'openai-again'}));
    await store.saveVerifiedConnection(anthropicConnection({api_key: ''}));
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

    const saved = await store.saveVerifiedConnection(openAiConnection({api_key: ''}));
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
        ['Base URL credentials', openAiConnection({base_url: 'https://account:password@api.example/v1'})],
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
        ['renderer capability claim', openAiConnection({vision_verified: true})],
        ['unknown field', openAiConnection({settings_path: 'C:\\secret', access_token: 'leak'})],
    ];

    for (const [name, connection] of invalidConnections) {
        await t.test(name, () => {
            assert.throws(() => validateModelConnection(connection), /invalid|unsupported|required/i);
        });
    }
});

test('connection validation rejects remote HTTP and allows loopback HTTP', async () => {
    const {validateModelConnection} = await import(SETTINGS_MODULE);

    assert.throws(
        () => validateModelConnection(openAiConnection({base_url: 'http://provider.example/v1'})),
        /base_url/i,
    );
    for (const base_url of [
        'http://localhost:9000/v1/',
        'http://127.0.0.1:9000/v1/',
        'http://[::1]:9000/v1/',
    ]) {
        assert.equal(
            validateModelConnection(openAiConnection({base_url})).base_url,
            base_url.replace(/\/+$/, ''),
        );
    }
});

test('credential-bearing provider URLs are rejected before save and when loading encrypted settings', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });
    const credentialUrl = 'https://account:password@api.openai.example/v1';

    await assert.rejects(
        store.saveVerifiedConnection(openAiConnection({base_url: credentialUrl})),
        /base_url/i,
    );
    assert.equal(fs.existsSync(temporary.file), false);

    writeEncryptedSettings(temporary.file, 3, {
        active_profile: 'generic_openai',
        connections: {
            generic_openai: {
                ...openAiConnection({base_url: credentialUrl}),
                vision_verified: true,
            },
        },
    });

    const summary = await store.loadSummary();
    assert.deepEqual(summary, {active_profile: 'generic_openai', connections: {}});
    assert.doesNotMatch(JSON.stringify(summary), /account|password|api\.openai\.example/i);
    assert.equal(fs.existsSync(temporary.file), false);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('summary exposes required connection metadata and no secret-bearing fields', async () => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    const temporary = temporarySettingsPath();
    const store = new ModelConnectionStore({
        safeStorage: fakeSafeStorage(), settingsPath: temporary.file,
    });

    const summary = await store.saveVerifiedConnection(openAiConnection());
    assert.deepEqual(
        Object.keys(summary.connections.generic_openai).sort(),
        ['base_url', 'has_api_key', 'max_tokens', 'model', 'profile_id', 'protocol', 'temperature', 'vision_verified'],
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

    await store.saveVerifiedConnection(openAiConnection());
    assert.deepEqual(writes, [`${temporary.file}.tmp`]);
    assert.deepEqual(renames, [[`${temporary.file}.tmp`, temporary.file]]);

    const unavailablePath = path.join(temporary.directory, 'unavailable.json');
    const unavailableStore = new ModelConnectionStore({
        safeStorage: fakeSafeStorage({available: false}), settingsPath: unavailablePath,
    });
    await assert.rejects(
        unavailableStore.saveVerifiedConnection(openAiConnection()),
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
    await availableStore.saveVerifiedConnection(openAiConnection());
    const before = fs.readFileSync(temporary.file);

    const unavailableStore = new ModelConnectionStore({
        safeStorage: fakeSafeStorage({available: false}), settingsPath: temporary.file,
    });
    await assert.rejects(unavailableStore.saveVerifiedConnection(anthropicConnection()), /encryption/i);
    assert.deepEqual(fs.readFileSync(temporary.file), before);
    fs.rmSync(temporary.directory, {recursive: true, force: true});
});

test('failed trusted save preserves the previous version-2 or version-3 envelope', async (t) => {
    const {ModelConnectionStore} = await import(SETTINGS_MODULE);
    for (const version of [2, 3]) {
        await t.test(`version ${version}`, async () => {
            const temporary = temporarySettingsPath();
            writeEncryptedSettings(temporary.file, version, {
                active_profile: 'generic_openai',
                connections: {
                    generic_openai: {
                        ...openAiConnection(),
                        ...(version === 3 ? {vision_verified: true} : {}),
                    },
                },
            });
            const before = fs.readFileSync(temporary.file);
            const fileSystem = {
                readFile: fs.promises.readFile,
                mkdir: fs.promises.mkdir,
                writeFile: fs.promises.writeFile,
                unlink: fs.promises.unlink,
                rename: async () => { throw new Error('simulated rename failure'); },
            };
            const store = new ModelConnectionStore({
                safeStorage: fakeSafeStorage(), settingsPath: temporary.file, fileSystem,
            });

            await assert.rejects(
                store.saveVerifiedConnection(anthropicConnection()),
                /persist encrypted model connections/i,
            );
            assert.deepEqual(fs.readFileSync(temporary.file), before);
            assert.equal(fs.existsSync(`${temporary.file}.tmp`), false);
            fs.rmSync(temporary.directory, {recursive: true, force: true});
        });
    }
});
