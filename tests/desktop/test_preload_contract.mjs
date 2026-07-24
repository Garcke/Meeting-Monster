import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => fs.readFileSync(path.join(projectRoot, ...parts), 'utf8');

test('preload exports one fixed nested Meeting Monster API', () => {
    const source = read('desktop', 'src', 'preload', 'index.ts');
    const exposedNamespaces = [...source.matchAll(
        /\bcontextBridge\.exposeInMainWorld\s*\(\s*(['"])([^'"]+)\1/g,
    )].map((match) => match[2]);

    assert.equal(exposedNamespaces.length, 1);
    assert.deepEqual(exposedNamespaces, ['meetingMonster']);
    assert.match(source, /contextBridge\.exposeInMainWorld\(\s*(['"])meetingMonster\1,\s*meetingMonster\s*\)/);
    assert.match(source, /window:\s*\{/);
    assert.match(source, /quit: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.window\.quit\)/);
    assert.match(source, /privacy:\s*\{/);
    assert.match(source, /models:\s*\{/);
    assert.match(source, /chat:\s*\{/);
    assert.match(source, /asrModels:\s*\{/);
    assert.match(source, /asr:\s*\{/);
    assert.match(source, /overlay:\s*\{/);
    assert.match(source, /intent:\s*\(intent(?:: OverlayIntent)?\)/);
    assert.match(source, /getSnapshot:\s*\(\)/);
    assert.match(source, /onSnapshot: \(callback/);
    assert.match(source, /onWindowError: \(callback/);
    assert.match(source, /writePcm:\s*\(chunk\)/);
    assert.match(source, /if \(!\(chunk instanceof Int16Array\) \|\| chunk\.byteLength === 0\)/);
    assert.match(source, /if \(!pcmPort\) throw new Error\('ASR is not recording'\)/);
    assert.match(source, /postMessage\(copy\)/);
    assert.match(source, /onState: \(callback: \(state: WindowState\) => void\)/);
    assert.match(source, /onStatus: \(callback: \(status: PrivacyStatus\) => void\)/);
    assert.doesNotMatch(source, /monsterOfferPrivacy|meetingMonsterDesktop/);
    assert.match(source, /IPC_CHANNELS\.asrModels\.download/);
    assert.match(source, /onStatus:.*IPC_CHANNELS\.asrModels\.status/s);
    assert.match(source, /onSnapshot:.*IPC_CHANNELS\.overlay\.snapshot/s);
    assert.match(source, /onWindowError:.*IPC_CHANNELS\.overlay\.windowError/s);
    assert.match(source, /function closePcmPort\(\): void \{[\s\S]*?pcmPort\?\.close\(\);[\s\S]*?pcmPort = null;/);
    assert.doesNotMatch(source, /fetch\s*\(|new WebSocket|writeFile|readFile|ipcRenderer\.send\(\s*[^I]/);
    assert.doesNotMatch(source, /send\s*:\s*ipcRenderer|invoke\s*:\s*ipcRenderer|on\s*:\s*ipcRenderer/);
    assert.doesNotMatch(source, /exposeInMainWorld\([^,]+,\s*\{[^}]*ipcRenderer/s);
});

test('shared contracts reserve typed IPC channel families for later desktop work', () => {
    const source = read('desktop', 'src', 'shared', 'contracts.ts');

    assert.match(source, /export const IPC_CHANNELS/);
    for (const family of ['window', 'privacy', 'models', 'chat', 'asrModels', 'asr', 'overlay']) {
        assert.match(source, new RegExp(`${family}:`));
    }
    assert.match(source, /export type IpcChannel/);
    assert.match(source, /export interface MeetingMonsterApi/);
    assert.match(source, /quit\(\): Promise<void>/);
    for (const typeName of ['OverlayTarget', 'OverlayPhase', 'OverlaySnapshot', 'OverlayIntent']) {
        assert.match(source, new RegExp(`export (?:type|interface) ${typeName}\\b`));
    }
    assert.match(source, /overlay:\s*\{[\s\S]*?intent\(intent: OverlayIntent\): Promise<OverlaySnapshot>/);
    assert.match(source, /getSnapshot\(\): Promise<OverlaySnapshot>/);
    assert.match(source, /onSnapshot\(callback: \(snapshot: OverlaySnapshot\) => void\): Unsubscribe/);
    assert.match(source, /onWindowError\(callback: \(error: string\) => void\): Unsubscribe/);
});

test('shared contracts expose public ASR model snapshots without private download or filesystem data', () => {
    const source = read('desktop', 'src', 'shared', 'contracts.ts');
    const view = source.match(/export interface AsrModelView\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const snapshot = source.match(/export interface AsrModelSnapshot\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    for (const field of [
        'id: AsrModelId',
        'label: string',
        'languages: string[]',
        'description: string',
        'estimatedBytes: number',
        'supportsHotwords: boolean',
        'installedState: AsrModelState',
        'isCurrent: boolean',
        'downloadedBytes: number',
        'totalBytes: number',
        'errorMessage?: string',
    ]) {
        assert.equal(view.includes(field), true, `missing public ASR model field: ${field}`);
    }
    assert.match(snapshot, /currentModelId: AsrModelId/);
    assert.match(snapshot, /models: AsrModelView\[\]/);
    assert.doesNotMatch(`${view}\n${snapshot}`, /url|path|sha|hash|checksum/i);
    assert.match(source, /asrModels:\s*\{[\s\S]*list\(\): Promise<AsrModelSnapshot>/);
    assert.match(source, /select\(modelId: AsrModelId\)/);
    assert.match(source, /download\(modelId: AsrModelId\)/);
    assert.match(source, /cancel\(modelId: AsrModelId\)/);
    assert.match(source, /delete\(modelId: AsrModelId\)/);
    assert.match(source, /onStatus\(callback: \(snapshot: AsrModelSnapshot\) => void\): Unsubscribe/);
});

test('model settings IPC and preload return the version-2 non-secret summary map', () => {
    const contracts = read('desktop', 'src', 'shared', 'contracts.ts');
    const preload = read('desktop', 'src', 'preload', 'index.ts');
    const summary = contracts.match(
        /export interface SavedModelConnectionSettings\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? '';

    assert.match(summary, /active_profile: ModelProfileId/);
    assert.match(
        summary,
        /connections: Partial<Record<ModelProfileId, SavedModelConnection>>/,
    );
    assert.match(
        contracts,
        /getSaved\(\): Promise<SavedModelConnectionSettings>/,
    );
    assert.match(
        contracts,
        /save\(connection: ModelConnectionInput\): Promise<SavedModelConnectionSettings>/,
    );
    assert.match(preload, /type SavedModelConnectionSettings/);
    assert.match(
        preload,
        /getSaved: \(\) =>[\s\S]*?as Promise<SavedModelConnectionSettings>/,
    );
    assert.match(
        preload,
        /save: \(connection: ModelConnectionInput\) =>[\s\S]*?as Promise<SavedModelConnectionSettings>/,
    );
});
