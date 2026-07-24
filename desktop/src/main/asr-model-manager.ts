import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {extractVerifiedTarBz2} from './asr-archive-extractor';
import {DEFAULT_ASR_MODEL_ID, getAsrModelCatalog, type AsrModelDescriptor, type AsrModelFile, type AsrModelId, type AsrModelSource} from './asr-model-catalog';
import type {AsrModelState} from '../shared/contracts';

const STATE_FILE_NAME = 'current-model.json';
const PROVIDER_HOSTS = {
    modelscope: {
        initial: new Set(['modelscope.cn', 'www.modelscope.cn']),
        redirect: new Set(['modelscope.cn', 'www.modelscope.cn', 'cdn-lfs-cn-1.modelscope.cn']),
    },
    huggingface: {
        initial: new Set(['huggingface.co', 'www.huggingface.co']),
        redirect: new Set([
            'huggingface.co',
            'www.huggingface.co',
            'cdn-lfs.huggingface.co',
            'cdn-lfs-us-1.hf.co',
            'us.aws.cdn.hf.co',
            'cas-bridge.xethub.hf.co',
        ]),
    },
} as const;
const SAFETY_MARGIN_BYTES = 32 * 1024 * 1024;

export interface AsrModelSnapshot { currentModelId: AsrModelId; models: Array<{id: AsrModelId; state: AsrModelState; downloadedBytes: number; totalBytes: number}>; }
export type DownloadedSource = Map<string, Buffer> | {archive: Buffer} | {staged: true};
export type DownloadSource = (source: AsrModelSource, signal: AbortSignal, onProgress: (downloadedBytes: number, totalBytes: number) => void, stagingDirectory?: string) => Promise<DownloadedSource>;
export interface AsrModelManagerOptions {
    modelRoot: string; downloadSource?: DownloadSource; getFreeBytes?: () => Promise<number>; catalog?: readonly AsrModelDescriptor[]; defaultModelId?: AsrModelId;
}

function within(root: string, candidate: string): string {
    const resolvedRoot = path.resolve(root) + path.sep;
    const resolvedCandidate = path.resolve(candidate);
    if (!resolvedCandidate.startsWith(resolvedRoot)) throw new Error('ASR model path is outside the model directory');
    return resolvedCandidate;
}

function sha256(contents: Buffer): string { return crypto.createHash('sha256').update(contents).digest('hex'); }
function isNetworkFailure(error: unknown): boolean {
    const code = (error as {code?: string; cause?: {code?: string}}).code
        ?? (error as {cause?: {code?: string}}).cause?.code;
    const status = (error as {status?: number}).status;
    return Boolean(code && /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/.test(code)) || (typeof status === 'number' && status >= 500);
}
function abortIfNeeded(signal: AbortSignal): void { if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Download cancelled'); }

export class AsrModelManager {
    public readonly modelRoot: string;
    public readonly stagingRoot: string;
    private readonly statePath: string;
    private readonly catalog: readonly AsrModelDescriptor[];
    private readonly defaultModelId: AsrModelId;
    private readonly downloadSource: DownloadSource;
    private readonly getFreeBytes: () => Promise<number>;
    private readonly entries = new Map<AsrModelId, {state: AsrModelState; downloadedBytes: number; totalBytes: number}>();
    private readonly listeners = new Set<(snapshot: AsrModelSnapshot) => void>();
    private readonly active = new Map<AsrModelId, AbortController>();
    private persistence: Promise<void> = Promise.resolve();
    private currentModelId: AsrModelId;

    constructor(options: AsrModelManagerOptions) {
        this.modelRoot = path.resolve(options.modelRoot);
        this.stagingRoot = path.join(this.modelRoot, '.staging');
        this.statePath = path.join(this.modelRoot, STATE_FILE_NAME);
        this.catalog = options.catalog ?? getAsrModelCatalog(); this.defaultModelId = options.defaultModelId ?? DEFAULT_ASR_MODEL_ID;
        this.currentModelId = this.defaultModelId; this.downloadSource = options.downloadSource ?? createFetchDownloadSource();
        this.getFreeBytes = options.getFreeBytes ?? (async () => Number.MAX_SAFE_INTEGER);
        for (const model of this.catalog) this.entries.set(model.id, {state: 'not-downloaded', downloadedBytes: 0, totalBytes: model.estimatedBytes});
    }
    get snapshot(): AsrModelSnapshot { return {currentModelId: this.currentModelId, models: this.catalog.map((model) => ({id: model.id, ...this.entries.get(model.id)!}))}; }
    subscribe(listener: (snapshot: AsrModelSnapshot) => void): () => void { this.listeners.add(listener); listener(this.snapshot); return () => this.listeners.delete(listener); }
    private emit(): void { const snapshot = this.snapshot; for (const listener of this.listeners) listener(snapshot); }
    private requireModel(id: string): AsrModelDescriptor { const model = this.catalog.find((item) => item.id === id); if (!model) throw new Error(`Unknown ASR model: ${id}`); return model; }
    public getModelDirectory(id: AsrModelId): string { this.requireModel(id); return within(this.modelRoot, path.join(this.modelRoot, id)); }
    public getStagingDirectory(id: AsrModelId): string { this.requireModel(id); return within(this.stagingRoot, path.join(this.stagingRoot, id)); }
    async initialize(): Promise<AsrModelSnapshot> {
        await fsp.mkdir(this.modelRoot, {recursive: true}); await fsp.mkdir(this.stagingRoot, {recursive: true});
        for (const model of this.catalog) await fsp.rm(this.getStagingDirectory(model.id), {recursive: true, force: true});
        try { const saved = JSON.parse(await fsp.readFile(this.statePath, 'utf8')) as {currentModelId?: string}; if (saved.currentModelId) this.currentModelId = this.requireModel(saved.currentModelId).id; }
        catch { this.currentModelId = this.defaultModelId; }
        for (const model of this.catalog) if (await isInstalled(this.getModelDirectory(model.id), model.requiredFiles)) this.entries.get(model.id)!.state = 'installed';
        await this.persist(); this.emit(); return this.snapshot;
    }
    async download(id: string, signal = new AbortController().signal): Promise<void> {
        const model = this.requireModel(id); const entry = this.entries.get(model.id)!;
        if (this.active.has(model.id)) throw new Error(`ASR model download already active: ${id}`);
        const controller = new AbortController();
        const forwardAbort = () => controller.abort(signal.reason);
        if (signal.aborted) forwardAbort(); else signal.addEventListener('abort', forwardAbort, {once: true});
        this.active.set(model.id, controller);
        const staging = this.getStagingDirectory(model.id);
        try {
            abortIfNeeded(controller.signal);
            if (await isInstalled(this.getModelDirectory(model.id), model.requiredFiles)) {
                entry.state = 'installed'; entry.downloadedBytes = entry.totalBytes; this.currentModelId = model.id; await this.persist(); this.emit(); return;
            }
            const source = model.sources[0]; if (!source) throw new Error('No ASR model source');
            await this.requireFreeSpace(source); await resetStaging(staging);
            entry.state = 'downloading'; entry.downloadedBytes = 0; entry.totalBytes = source.files.reduce((sum, file) => sum + file.bytes, 0); this.emit();
            let payload: DownloadedSource; let usedSource = source;
            try { payload = await this.downloadSource(source, controller.signal, (done, total) => { entry.downloadedBytes = done; entry.totalBytes = total; this.emit(); }, staging); }
            catch (error) {
                if (controller.signal.aborted) throw error;
                if (!isNetworkFailure(error) || !model.sources[1]) throw error;
                usedSource = model.sources[1]; await this.requireFreeSpace(usedSource); await resetStaging(staging);
                entry.downloadedBytes = 0; entry.totalBytes = usedSource.files.reduce((sum, file) => sum + file.bytes, 0); this.emit();
                payload = await this.downloadSource(usedSource, controller.signal, (done, total) => { entry.downloadedBytes = done; entry.totalBytes = total; this.emit(); }, staging);
            }
            abortIfNeeded(controller.signal); entry.state = 'verifying'; this.emit();
            await this.stagePayload(payload, model, usedSource, staging); abortIfNeeded(controller.signal); await this.install(staging, model.id);
            entry.state = 'installed'; entry.downloadedBytes = entry.totalBytes; this.currentModelId = model.id; await this.persist(); this.emit();
        } catch (error) {
            await fsp.rm(staging, {recursive: true, force: true});
            entry.state = controller.signal.aborted ? 'not-downloaded' : 'failed';
            entry.downloadedBytes = 0;
            this.emit();
            throw error;
        }
        finally { signal.removeEventListener('abort', forwardAbort); this.active.delete(model.id); }
    }
    private async requireFreeSpace(source: AsrModelSource): Promise<void> {
        const available = await this.getFreeBytes(); const required = source.files.reduce((sum, file) => sum + file.bytes, 0) + SAFETY_MARGIN_BYTES;
        if (available < required) throw new Error(`Insufficient free space: required ${required} bytes, available ${available} bytes`);
    }
    private async stagePayload(payload: DownloadedSource, model: AsrModelDescriptor, source: AsrModelSource, staging: string): Promise<void> {
        if ('staged' in payload) {
            if (source.kind === 'archive') {
                const archivePath = within(staging, path.join(staging, '.archive.part'));
                const archiveEntry = await fsp.lstat(archivePath);
                if (!archiveEntry.isFile() || archiveEntry.isSymbolicLink()) throw new Error('ASR archive staging file is invalid');
                await extractVerifiedTarBz2(archivePath, staging, model.requiredFiles);
                await fsp.rm(archivePath, {force: true});
            }
            await verifyStaging(staging, model.requiredFiles);
            return;
        }
        if (payload instanceof Map) {
            if (payload.size !== model.requiredFiles.length) throw new Error('ASR model manifest contains unexpected files');
            for (const file of source.files) {
                const contents = payload.get(file.name); if (!contents) continue;
                const destination = within(staging, path.join(staging, file.name)); const part = `${destination}.part`;
                await fsp.writeFile(part, contents, {flag: 'wx'}); await verify(file, await fsp.readFile(part)); await fsp.rename(part, destination);
            }
            await verifyStaging(staging, model.requiredFiles);
            return;
        }
        const archiveFile = source.files[0]; if (!archiveFile || !('archive' in payload)) throw new Error('ASR model download payload is invalid'); await verify(archiveFile, payload.archive);
        const archivePath = path.join(staging, '.archive.part'); await fsp.writeFile(archivePath, payload.archive, {flag: 'wx'});
        await extractVerifiedTarBz2(archivePath, staging, model.requiredFiles); await fsp.rm(archivePath, {force: true}); await verifyStaging(staging, model.requiredFiles);
    }
    private async install(staging: string, id: AsrModelId): Promise<void> {
        const finalDirectory = this.getModelDirectory(id); const backup = within(this.modelRoot, path.join(this.modelRoot, `.${id}.backup-${Date.now()}-${Math.random().toString(16).slice(2)}`));
        let backedUp = false;
        try { if (fs.existsSync(finalDirectory)) { await fsp.rename(finalDirectory, backup); backedUp = true; } await fsp.rename(staging, finalDirectory); if (backedUp) await fsp.rm(backup, {recursive: true, force: true}); }
        catch (error) {
            if (backedUp && fs.existsSync(backup)) {
                if (fs.existsSync(finalDirectory)) await fsp.rm(finalDirectory, {recursive: true, force: true});
                await fsp.rename(backup, finalDirectory);
            }
            throw error;
        }
    }
    /** Selects a fixed catalog model only after its exact installed file set is present. */
    async selectModel(id: string): Promise<AsrModelSnapshot> {
        const model = this.requireModel(id);
        if (!(await isInstalled(this.getModelDirectory(model.id), model.requiredFiles))) throw new Error(`ASR model is not installed: ${id}`);
        this.entries.get(model.id)!.state = 'installed'; this.currentModelId = model.id; await this.persist(); this.emit(); return this.snapshot;
    }
    /** Cancels the active download for one fixed catalog model. Returns whether a download was active. */
    cancel(id: string): boolean {
        const controller = this.active.get(id as AsrModelId);
        if (!controller) return false;
        controller.abort(new Error('Download cancelled'));
        return true;
    }
    async delete(id: string): Promise<void> { const model = this.requireModel(id); if (this.active.has(model.id)) throw new Error(`ASR model has an active download: ${id}`); await fsp.rm(this.getModelDirectory(model.id), {recursive: true, force: true}); this.entries.get(model.id)!.state = 'not-downloaded'; this.entries.get(model.id)!.downloadedBytes = 0; if (this.currentModelId === model.id) this.currentModelId = this.defaultModelId; await this.persist(); this.emit(); }
    private persist(): Promise<void> {
        const payload = JSON.stringify({currentModelId: this.currentModelId});
        const job = this.persistence.then(async () => { const tmp = `${this.statePath}.tmp`; await fsp.writeFile(tmp, payload, 'utf8'); await fsp.rename(tmp, this.statePath); });
        this.persistence = job.catch(() => undefined);
        return job;
    }
}

async function verify(file: AsrModelFile, contents: Buffer): Promise<void> { if (contents.length !== file.bytes) throw new Error(`ASR model size mismatch for ${file.name}`); if (sha256(contents) !== file.sha256) throw new Error(`ASR model checksum mismatch for ${file.name}`); }
async function verifyStaging(directory: string, requiredFiles: readonly string[]): Promise<void> { const names = await fsp.readdir(directory); if (names.length !== requiredFiles.length || names.some((name) => !requiredFiles.includes(name))) throw new Error('ASR model staging contains unexpected files'); for (const file of requiredFiles) { const entry = await fsp.lstat(path.join(directory, file)); if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`ASR model required file missing: ${file}`); } }
async function isInstalled(directory: string, requiredFiles: readonly string[]): Promise<boolean> { try { await verifyStaging(directory, requiredFiles); return true; } catch { return false; } }
async function resetStaging(directory: string): Promise<void> { await fsp.rm(directory, {recursive: true, force: true}); await fsp.mkdir(directory, {recursive: true}); }

export function createFetchDownloadSource(fetchFn: typeof fetch = fetch): DownloadSource {
    return async (source, signal, onProgress, stagingDirectory) => {
        if (!stagingDirectory) throw new Error('ASR download requires a staging directory');
        await fsp.mkdir(stagingDirectory, {recursive: true});
        let done = 0; const total = source.files.reduce((sum, file) => sum + file.bytes, 0);
        for (const file of source.files) {
            const url = fixedUrl(source, file.name); const response = await fetchFixed(url, source.provider, fetchFn, signal);
            if (!response.ok) throw Object.assign(new Error(`ASR source returned ${response.status}`), {status: response.status});
            const destination = source.kind === 'archive'
                ? within(stagingDirectory, path.join(stagingDirectory, '.archive.part'))
                : within(stagingDirectory, path.join(stagingDirectory, file.name));
            const part = source.kind === 'archive' ? destination : `${destination}.part`;
            try {
                done += await streamResponseToPart(response, part, file, signal, done, total, onProgress);
                await fsp.rename(part, destination);
            } catch (error) {
                await fsp.rm(part, {force: true});
                throw error;
            }
            if (source.kind === 'archive') return {staged: true};
        }
        return {staged: true};
    };
}
async function streamResponseToPart(
    response: Response,
    partPath: string,
    file: AsrModelFile,
    signal: AbortSignal,
    initialBytes: number,
    totalBytes: number,
    onProgress: (downloadedBytes: number, totalBytes: number) => void,
): Promise<number> {
    if (!response.body) throw new Error('ASR source response has no body');
    const reader = response.body.getReader(); const handle = await fsp.open(partPath, 'wx'); const digest = crypto.createHash('sha256');
    let downloaded = 0;
    try {
        while (true) {
            abortIfNeeded(signal);
            const chunk = await reader.read(); if (chunk.done) break;
            const contents = Buffer.from(chunk.value);
            downloaded += contents.length;
            if (downloaded > file.bytes) throw new Error(`ASR model size mismatch for ${file.name}`);
            await handle.write(contents); digest.update(contents); onProgress(initialBytes + downloaded, totalBytes);
        }
        if (downloaded !== file.bytes) throw new Error(`ASR model size mismatch for ${file.name}`);
        if (digest.digest('hex') !== file.sha256) throw new Error(`ASR model checksum mismatch for ${file.name}`);
        return downloaded;
    } finally {
        await handle.close();
    }
}
function fixedUrl(source: AsrModelSource, name: string): URL { if (!source.files.some((file) => file.name === name)) throw new Error('ASR source file is not in the fixed manifest'); const url = new URL(`${source.urlRoot}/${encodeURIComponent(name)}`); validateUrl(url, source.provider, false); return url; }
function validateUrl(url: URL, provider: AsrModelSource['provider'], redirected: boolean): void {
    const hosts = PROVIDER_HOSTS[provider][redirected ? 'redirect' : 'initial'];
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password || url.hash || (!redirected && url.search)) throw new Error('ASR download URL is not an allowed fixed HTTPS source');
}
async function fetchFixed(initial: URL, provider: AsrModelSource['provider'], fetchFn: typeof fetch, signal: AbortSignal): Promise<Response> {
    let url = initial;
    for (let hops = 0; hops < 5; hops += 1) {
        const response = await fetchFn(url, {redirect: 'manual', signal}); if (response.status < 300 || response.status > 399) return response;
        const location = response.headers.get('location'); if (!location) throw Object.assign(new Error('ASR source redirect has no location'), {status: 502});
        url = new URL(location, url);
        try { validateUrl(url, provider, true); } catch (error) { throw Object.assign(error as Error, {status: 502}); }
    }
    throw Object.assign(new Error('ASR source exceeded redirect limit'), {status: 502});
}
