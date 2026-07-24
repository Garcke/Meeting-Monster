import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'build-desktop.yml');

test('tag release workflow builds and publishes only unsigned Windows artifacts', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    assert.match(workflow, /run: npm --prefix desktop run dist:win:unsigned/);
    assert.match(workflow, /path: desktop\/release\/\*\.exe/);
    assert.match(workflow, /name: meeting-monster-windows/);
    assert.match(workflow, /gh release create/);
    assert.match(workflow, /mapfile -t assets/);
    assert.doesNotMatch(workflow, /desktop\/dist\/\*\.(?:exe|dmg|zip)/);
    assert.doesNotMatch(workflow, /dist:mac|\.dmg|\.zip|macos/);
    assert.doesNotMatch(workflow, /forceCodeSigning=true/);
});
