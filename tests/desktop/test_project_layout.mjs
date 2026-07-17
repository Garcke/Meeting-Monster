import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const desktopRoot = path.join(projectRoot, 'desktop');

function filesIn(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? filesIn(entryPath) : [entryPath];
    });
}

test('desktop source, package scripts, and documentation do not retain local Python or ASR packaging hooks', () => {
    const desktopFiles = [
        ...filesIn(path.join(desktopRoot, 'src')),
        ...filesIn(path.join(desktopRoot, 'renderer')),
        path.join(desktopRoot, 'package.json'),
        path.join(desktopRoot, 'README.md'),
    ];
    const forbidden = [
        /server\/app\.py/i,
        /python -m server\.app/i,
        /MONSTER_OFFER_PYTHON/i,
        /MONSTER_OFFER_PROJECT_ROOT/i,
        /sherpa-onnx-node/i,
        /model-manager/i,
        /utilityProcess/i,
        /download_asr_model/i,
    ];

    for (const file of desktopFiles) {
        const contents = fs.readFileSync(file, 'utf8');
        for (const pattern of forbidden) {
            assert.doesNotMatch(contents, pattern, `${path.relative(projectRoot, file)} must not contain ${pattern}`);
        }
    }
});
