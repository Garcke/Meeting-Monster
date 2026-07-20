import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const overlayHtmlPath = path.join(projectRoot, 'desktop', 'renderer', 'overlay.html');
const controllerPath = path.join(projectRoot, 'desktop', 'renderer', 'model-settings.js');

async function loadModelSettingsController() {
    const source = fs.readFileSync(controllerPath, 'utf8');
    return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

test('model settings renderer exposes selectable vendors and saved connection controls', () => {
    const html = fs.readFileSync(overlayHtmlPath, 'utf8');
    const source = fs.existsSync(controllerPath) ? fs.readFileSync(controllerPath, 'utf8') : '';
    const requiredIds = [
        'overlaySettingsButton', 'overlayActiveModel', 'overlaySettingsDrawer', 'overlaySettingsClose',
        'modelList', 'modelForm', 'modelProtocol', 'modelApiKey', 'modelMaxTokens', 'modelTemperature',
        'modelTestButton', 'modelSaveButton', 'modelStatus',
    ];

    for (const id of requiredIds) assert.match(html, new RegExp(`id="${id}"`));
    for (const id of ['serverBaseUrl', 'serverAdminToken', 'modelBaseUrl', 'modelName', 'modelCancelButton']) {
        assert.doesNotMatch(html, new RegExp(`id="${id}"`));
    }
    assert.match(source, /export class ModelSettingsController/);
    assert.doesNotMatch(html, /id="modelProtocol"[^>]*disabled/);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bWebSocket\b/);
    assert.match(source, /this\.api\.models\.list/);
    assert.match(source, /this\.api\.models\.test/);
    assert.match(source, /this\.api\.models\.save/);
    assert.match(source, /modelProtocol.*change|addEventListener\(['"]change['"]/s);
    assert.match(source, /profile_id/);
    assert.doesNotMatch(source, /meetingMonster\.models\.(create|update|delete|activate)/);
    assert.match(source, /profile_id/);
});

function createElement() {
    return {
        children: [],
        textContent: '',
        className: '',
        type: '',
        append(...nodes) { this.children.push(...nodes); },
        appendChild(node) { this.children.push(node); },
        addEventListener() {},
        replaceChildren(...nodes) { this.children = nodes; },
    };
}

test('selecting a backend profile refreshes the active-model callback', async () => {
    const {ModelSettingsController} = await loadModelSettingsController();
    const activeProfile = {
        id: 'new', label: 'Current', protocol: 'openai', model: 'gpt',
        api_key_required: true, max_tokens: 100, temperature: 0.2, active: true,
    };
    const updates = [];
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    globalThis.window = {confirm: () => true};
    globalThis.document = {createElement};
    try {
        const controller = new ModelSettingsController({
            api: {
                models: {list: async () => ({active_profile: 'new', profiles: [activeProfile]})},
            },
            elements: {modelList: createElement(), modelStatus: createElement()},
            onActiveModelChanged: (profile) => updates.push(profile),
        });

        await controller.selectProfile(activeProfile);
        assert.deepEqual(updates, [activeProfile]);
    } finally {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    }
});

test('saving a selected model persists the current vendor and advanced fields', async () => {
    const {ModelSettingsController} = await loadModelSettingsController();
    const activeProfile = {
        id: 'generic_anthropic', label: 'Anthropic', protocol: 'anthropic', model: 'claude',
        api_key_required: true, max_tokens: 100, temperature: 0.2, active: true,
    };
    const elements = {
        modelList: createElement(), modelStatus: createElement(), modelForm: createElement(),
        modelProtocol: {value: 'anthropic', addEventListener() {}},
        modelApiKey: {value: 'temporary-key'}, modelMaxTokens: {value: '2048'},
        modelTemperature: {value: '0.4'}, modelSaveButton: {addEventListener() {}},
        modelTestButton: {addEventListener() {}},
    };
    const saved = [];
    const controller = new ModelSettingsController({
        api: {
            models: {
                list: async () => ({active_profile: activeProfile.id, profiles: [activeProfile]}),
                save: async (selection) => { saved.push(selection); return {profile_id: selection.profile_id}; },
            },
        },
        elements,
    });

    await controller.refreshModels();
    elements.modelApiKey.value = 'temporary-key';
    elements.modelMaxTokens.value = '2048';
    elements.modelTemperature.value = '0.4';
    await controller.saveConnection();
    assert.deepEqual(saved, [{
        profile_id: 'generic_anthropic', protocol: 'anthropic', api_key: 'temporary-key',
        max_tokens: 2048, temperature: 0.4,
    }]);
});
