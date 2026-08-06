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
    assert.match(source, /audioInput:\s*\{/);
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

test('overlay and settings preloads expose separate least-privilege APIs', () => {
    const overlayPreloadSource = fs.readFileSync(
        path.join(projectRoot, 'desktop', 'src', 'preload', 'index.ts'),
        'utf8',
    );
    const settingsPreloadSource = fs.readFileSync(
        path.join(projectRoot, 'desktop', 'src', 'preload', 'settings.ts'),
        'utf8',
    );

    assert.match(overlayPreloadSource, /open: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.settings\.open\)/);
    assert.match(overlayPreloadSource, /onChanged: .*IPC_CHANNELS\.models\.changed/s);
    assert.match(overlayPreloadSource, /audioInput:\s*\{[\s\S]*?get: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.audioInput\.get\)[\s\S]*?set: \(mode: AudioInputMode\) => ipcRenderer\.invoke\(IPC_CHANNELS\.audioInput\.set, mode\)[\s\S]*?onChanged: \(callback: \(mode: AudioInputMode\) => void\) => subscribe\(IPC_CHANNELS\.audioInput\.changed, callback\)/);
    assert.doesNotMatch(overlayPreloadSource, /settings\.close|settings\.getAppVersion/);
    assert.match(settingsPreloadSource, /contextBridge\.exposeInMainWorld\('meetingMonsterSettings'/);
    assert.match(settingsPreloadSource, /close: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.settings\.close\)/);
    assert.match(settingsPreloadSource, /getAppVersion: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.settings\.getAppVersion\)/);
    assert.match(settingsPreloadSource, /audioInput:\s*\{[\s\S]*?get: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.audioInput\.get\)[\s\S]*?set: \(mode: AudioInputMode\) => ipcRenderer\.invoke\(IPC_CHANNELS\.audioInput\.set, mode\)[\s\S]*?onChanged: \(callback: \(mode: AudioInputMode\) => void\) => subscribe\(IPC_CHANNELS\.audioInput\.changed, callback\)/);
    assert.doesNotMatch(settingsPreloadSource, /IPC_CHANNELS\.(?:window|overlay|chat|asr)\./);
    assert.doesNotMatch(settingsPreloadSource, /writePcm|captureDisplay|assist:/);
});

test('shared contracts reserve typed IPC channel families for later desktop work', () => {
    const source = read('desktop', 'src', 'shared', 'contracts.ts');

    assert.match(source, /export const IPC_CHANNELS/);
    for (const family of ['window', 'privacy', 'audioInput', 'models', 'chat', 'asrModels', 'asr', 'overlay']) {
        assert.match(source, new RegExp(`${family}:`));
    }
    assert.match(source, /export type IpcChannel/);
    assert.match(source, /export interface MeetingMonsterApi/);
    assert.match(source, /export interface ChatImageInput\s*\{[\s\S]*?media_type: 'image\/png';[\s\S]*?data: string;/);
    assert.match(source, /export interface ModelTestResult\s*\{[\s\S]*?vision: true;/);
    assert.match(source, /chat:\s*\{[\s\S]*?assist: 'chat:assist'/);
    assert.match(source, /assist\(requestId: string, selection\?: ModelSelectionInput\): Promise<\{requestId: string\}>/);
    assert.doesNotMatch(source, /assist\(requestId: string, content:/);
    assert.match(source, /quit\(\): Promise<void>/);
    const overlayTypeReexports = source.match(/export type \{([^}]*)\} from '\.\/overlay-state';/)?.[1] ?? '';
    for (const typeName of ['OverlayTarget', 'OverlayPhase', 'OverlaySnapshot', 'OverlayIntent']) {
        const directExport = new RegExp(`export (?:type|interface) ${typeName}\\b`).test(source);
        const groupedReexport = new RegExp(`\\b${typeName}\\b`).test(overlayTypeReexports);
        assert.equal(directExport || groupedReexport, true, `missing exported overlay type: ${typeName}`);
    }
    assert.match(source, /overlay:\s*\{[\s\S]*?intent\(intent: OverlayIntent\): Promise<OverlaySnapshot>/);
    assert.match(source, /getSnapshot\(\): Promise<OverlaySnapshot>/);
    assert.match(source, /onSnapshot\(callback: \(snapshot: OverlaySnapshot\) => void\): Unsubscribe/);
    assert.match(source, /onWindowError\(callback: \(error: string\) => void\): Unsubscribe/);
});

test('preload exposes a narrow Assist request without accepting screenshot bytes', () => {
    const source = read('desktop', 'src', 'preload', 'index.ts');

    assert.match(
        source,
        /assist: \(requestId, selection\) => ipcRenderer\.invoke\(IPC_CHANNELS\.chat\.assist, requestId, selection\)/,
    );
    assert.doesNotMatch(source, /IPC_CHANNELS\.chat\.assist, requestId, content/);
    assert.doesNotMatch(source, /assist:\s*\([^)]*(?:image|screenshot|data)/i);
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

test('model settings IPC and preload return the version-3 non-secret vision summary map', () => {
    const contracts = read('desktop', 'src', 'shared', 'contracts.ts');
    const preload = read('desktop', 'src', 'preload', 'index.ts');
    const settings = read('desktop', 'src', 'main', 'model-connection-settings.ts');
    const summary = contracts.match(
        /export interface SavedModelConnectionSettings\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? '';
    const savedConnection = contracts.match(
        /export interface SavedModelConnection\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? '';

    assert.match(summary, /active_profile: ModelProfileId/);
    assert.doesNotMatch(savedConnection, /image|data/);
    assert.match(savedConnection, /vision_verified: boolean/);
    assert.doesNotMatch(savedConnection, /(?:^|\s)api_key\??:/m);
    assert.match(
        settings,
        /export interface ModelConnection extends ModelConnectionCandidate\s*\{[\s\S]*?vision_verified: boolean;/,
    );
    assert.doesNotMatch(settings, /vision_verified\?: boolean/);
    assert.doesNotMatch(settings, /saveConnection\s*\(/);
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

test('model-test progress is a narrow typed preload subscription with safe cleanup', () => {
    const contracts = read('desktop', 'src', 'shared', 'contracts.ts');
    const preload = read('desktop', 'src', 'preload', 'index.ts');

    assert.match(contracts, /progress: 'models:progress'/);
    assert.match(
        contracts,
        /export type ModelTestProgress = \{[\s\S]*?phase: 'connecting' \| 'vision';[\s\S]*?attempt: number;[\s\S]*?maxAttempts: typeof MAX_MODEL_TEST_ATTEMPTS;[\s\S]*?\};/,
    );
    assert.match(
        contracts,
        /onTestProgress\(callback: \(progress: ModelTestProgress\) => void\): Unsubscribe/,
    );
    assert.match(preload, /type ModelTestProgress/);
    assert.match(
        preload,
        /onTestProgress: \(callback: \(progress: ModelTestProgress\) => void\) => subscribe\(IPC_CHANNELS\.models\.progress, callback\)/,
    );
    assert.match(
        preload,
        /ipcRenderer\.removeListener\(channel, listener\)/,
    );
});
