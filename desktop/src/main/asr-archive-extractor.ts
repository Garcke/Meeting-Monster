import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import tar from 'tar-stream';
import unbzip2 from 'unbzip2-stream';

function archiveError(message: string): Error { return new Error(`Invalid ASR archive entry: ${message}`); }

export function validateArchiveEntry(
    name: string,
    type: string | undefined,
    requiredFiles: readonly string[],
    archiveRoot?: string,
): string | null {
    const normalized = name.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
        throw archiveError(name);
    }
    const segments = normalized.split('/');
    if (segments.some((segment) => segment.startsWith('._') || segment === '.DS_Store') ||
        normalized === '__MACOSX' || normalized.startsWith('__MACOSX/')) return null;
    const root = archiveRoot?.replace(/\\/g, '/').replace(/\/+$/, '');
    if (root && (!root || root.startsWith('/') || /^[A-Za-z]:/.test(root) || root.includes('/') || root.split('/').includes('..'))) {
        throw archiveError(archiveRoot!);
    }
    if (type === 'directory') {
        if (root && normalized === `${root}/`) return null;
        throw archiveError(`${name} (${type})`);
    }
    if (type && type !== 'file') throw archiveError(`${name} (${type})`);
    const relative = root
        ? normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : null
        : normalized;
    if (!relative || !requiredFiles.includes(relative)) throw archiveError(name);
    return relative;
}

export async function extractVerifiedTarBz2(archivePath: string, stagingDirectory: string, requiredFiles: readonly string[]): Promise<void> {
    await mkdir(stagingDirectory, {recursive: true});
    const seen = new Set<string>();
    let archiveRoot: string | undefined;
    const extractor = tar.extract();
    const completed = new Promise<void>((resolve, reject) => {
        extractor.once('finish', resolve); extractor.once('error', reject);
        extractor.on('entry', (header, entry, next) => {
            const normalizedName = header.name.replace(/\\/g, '/');
            if (header.type === 'directory' && !archiveRoot && normalizedName.endsWith('/')) {
                const candidate = normalizedName.slice(0, -1);
                if (candidate && !candidate.includes('/')) archiveRoot = candidate;
            }
            let file: string | null;
            try { file = validateArchiveEntry(header.name, header.type, requiredFiles, archiveRoot); }
            catch (error) { entry.resume(); next(error as Error); return; }
            if (file === null) { entry.resume(); next(); return; }
            if (seen.has(file)) { entry.resume(); next(archiveError(`duplicate ${file}`)); return; }
            seen.add(file);
            const destination = path.resolve(stagingDirectory, file);
            const root = path.resolve(stagingDirectory) + path.sep;
            if (!destination.startsWith(root)) { entry.resume(); next(archiveError(file)); return; }
            void mkdir(path.dirname(destination), {recursive: true}).then(async () => {
                try { await pipeline(entry, createWriteStream(destination, {flags: 'wx'})); next(); }
                catch (error) { next(error as Error); }
            }, next);
        });
    });
    try {
        await pipeline(createReadStream(archivePath), unbzip2(), extractor);
        await completed;
        if (seen.size !== requiredFiles.length || requiredFiles.some((file) => !seen.has(file))) throw archiveError('required file set');
    } catch (error) {
        await rm(stagingDirectory, {recursive: true, force: true});
        throw error;
    }
}
