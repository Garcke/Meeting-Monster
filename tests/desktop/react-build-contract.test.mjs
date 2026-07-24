import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const desktop = path.resolve(import.meta.dirname, '../../desktop');
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const viteSource = fs.readFileSync(path.join(desktop, 'vite.config.ts'), 'utf8');

test('renderer build contract is declared', () => {
  assert.match(pkg.scripts.build, /build:renderer/);
  assert.match(pkg.scripts['build:renderer'], /vite build/);
  assert.match(viteSource, /input:\s*\{\s*overlay:/s);
  assert.doesNotMatch(viteSource, /capsule:|panel:/);
  for (const file of ['ui/overlay.html']) {
    const html = fs.readFileSync(path.join(desktop, file), 'utf8');
    const roots = html.match(/<[^>]+\bid=["']root["'][^>]*>/g) ?? [];
    assert.equal(roots.length, 1, `${file} must contain exactly one root element`);
    assert.match(html, /Content-Security-Policy/);
  }
});
