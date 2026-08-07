# Capsule and Workspace Menu Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the capsule exit button, make window visibility a shortcut-only menu reference, rename screenshot protection to `应用隐藏`, and remove the selectable `拖动面板` hint without changing the underlying shortcuts, privacy behavior, drag region, or quit action.

**Architecture:** Keep the existing single-overlay architecture and IPC contracts unchanged. Make only renderer markup and CSS changes: reuse the existing `workspace-menu-reference` presentation for shortcut-only rows, remove the redundant drag-hint element while retaining the header drag region, and restyle the existing quit button without changing its callback. Lock each behavior with focused renderer and structural regression tests before running the full desktop and packaging validation matrix.

**Tech Stack:** Electron 37, React 19, TypeScript 5.9, CSS, Vitest/Testing Library, Node.js test runner, electron-builder.

## Global Constraints

- Work only in `D:\Code Project\Meeting-Monster\.worktrees\menu-clarity-exit` on branch `agent/menu-clarity-exit`.
- Preserve `Ctrl+\` shortcut registration and behavior; only remove the clickable renderer action.
- Preserve privacy toggle state, pending state, warning dot, API calls, and the explanatory copy `开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。`
- Use the exact user-facing privacy label `应用隐藏` and remove the label `截图保护` from the workspace menu.
- Remove the visible `拖动面板` text while preserving `.panel-drag-handle`, `data-drag-handle`, and `-webkit-app-region: drag`.
- Preserve the existing `退出 Meeting-Monster` title, accessible label, and `window.meetingMonster.window.quit()` callback.
- Do not change overlay geometry, recording controls, clear-chat behavior, settings navigation, app version `2.2.5`, shortcut registration, IPC contracts, or packaging configuration.
- Do not stage, delete, or otherwise modify pre-existing untracked files or dependency directories.

## File Responsibility Map

- `desktop/ui/panel/WorkspaceMenu.tsx`: menu semantics, shortcut reference rows, privacy label, privacy toggle behavior.
- `desktop/ui/panel/PanelApp.tsx`: expanded panel header composition and drag-region markup.
- `desktop/ui/panel/panel.css`: shared interactive/reference menu styling and panel drag-header styling.
- `desktop/ui/capsule/capsule.css`: capsule action-control appearance only.
- `tests/desktop/react_overlay.test.tsx`: rendered roles, menu behavior, privacy behavior, and absence of drag-hint text.
- `tests/desktop/test_floating_capsule.mjs`: static contracts for menu markup, capsule styling, and quit accessibility/wiring.
- `tests/desktop/test_frontend_structure.mjs`: static panel-header and drag-region contract.

---

### Task 1: Make window visibility shortcut-only and rename privacy control

**Files:**
- Modify: `desktop/ui/panel/WorkspaceMenu.tsx:77-119`
- Test: `tests/desktop/react_overlay.test.tsx:320-370`
- Test: `tests/desktop/test_floating_capsule.mjs:101-124`

**Interfaces:**
- Consumes: existing global `Ctrl+\` window-visibility shortcut handled outside the renderer; existing `window.meetingMonster.privacy.setCaptureProtection(enabled)` API.
- Produces: a non-focusable `.workspace-menu-reference` row for `显示/隐藏窗口`; an interactive `menuitemcheckbox` labelled `应用隐藏` with unchanged privacy behavior.

- [ ] **Step 1: Write failing renderer assertions for shortcut-only semantics and the new privacy label**

Update the workspace-menu test in `tests/desktop/react_overlay.test.tsx` so the relevant assertions are:

```tsx
const visibilityReference = screen.getByText('显示/隐藏窗口');
expect(visibilityReference.closest('.workspace-menu-reference')).toBeTruthy();
expect(screen.queryByRole('menuitem', {name: /显示\/隐藏窗口/})).toBeNull();
expect(screen.getByText('Ctrl+\\')).toBeTruthy();

expect(screen.getByRole('menuitemcheckbox', {name: /应用隐藏/})).toBeTruthy();
expect(screen.queryByText('截图保护')).toBeNull();
expect(screen.getByText('开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。')).toBeTruthy();
```

Update the failed-protection test to query the renamed control:

```tsx
const privacyItem = screen.getByRole('menuitemcheckbox', {name: /应用隐藏/});
expect(privacyItem.getAttribute('aria-checked')).toBe('false');
fireEvent.click(privacyItem);
expect(api.privacy.setCaptureProtection).toHaveBeenCalledWith(true);
```

Update `tests/desktop/test_floating_capsule.mjs` with exact source contracts:

```js
assert.match(source, /应用隐藏/);
assert.doesNotMatch(source, /截图保护/);
assert.match(source, /<div className="workspace-menu-reference">\s*<span>显示\/隐藏窗口<\/span>\s*<kbd>\{'Ctrl\+\\\\'\}<\/kbd>\s*<\/div>/);
assert.doesNotMatch(source, /onClick=\{hideWindow\}/);
assert.doesNotMatch(source, /const hideWindow\s*=/);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run from `desktop`:

```powershell
npm run unit-test -- --run ../tests/desktop/react_overlay.test.tsx
node --test ../tests/desktop/test_floating_capsule.mjs
```

Expected: the renderer test fails because `显示/隐藏窗口` is still a `menuitem` and `应用隐藏` does not exist; the structural test fails because `hideWindow` and `截图保护` remain.

- [ ] **Step 3: Implement the non-interactive reference row and rename the privacy label**

Remove the now-unused renderer helper from `WorkspaceMenu.tsx`:

```tsx
const hideWindow = () => {
    setOpen(false);
    void window.meetingMonster.window.hide().catch(() => setPanelError('窗口无法隐藏'));
};
```

Replace the clickable visibility button with the existing reference-row pattern:

```tsx
<div className="workspace-menu-reference">
    <span>显示/隐藏窗口</span>
    <kbd>{'Ctrl+\\'}</kbd>
</div>
```

Change only the privacy label text while preserving the button, role, checked state, disabled state, switch, description, and click handler:

```tsx
<button className="workspace-menu-item workspace-menu-privacy-item" type="button" role="menuitemcheckbox" aria-checked={privacyActive} disabled={!privacy || privacyPending} onClick={() => void togglePrivacy()}>
    <span className="workspace-menu-item-label">应用隐藏</span>
    <span className={`workspace-menu-switch ${privacyActive ? 'is-on' : ''}`} aria-hidden="true" />
    <span className="workspace-menu-privacy-copy">开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。</span>
</button>
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npm run unit-test -- --run ../tests/desktop/react_overlay.test.tsx
node --test ../tests/desktop/test_floating_capsule.mjs
npm run typecheck
```

Expected: all renderer/structural tests pass; TypeScript reports no unused helper or type errors.

- [ ] **Step 5: Inspect and commit Task 1**

```powershell
git diff --check
git diff -- desktop/ui/panel/WorkspaceMenu.tsx tests/desktop/react_overlay.test.tsx tests/desktop/test_floating_capsule.mjs
git add desktop/ui/panel/WorkspaceMenu.tsx tests/desktop/react_overlay.test.tsx tests/desktop/test_floating_capsule.mjs
git commit -m "fix: make window shortcut row non-interactive"
```

Expected: the commit contains only Task 1 files and does not alter shortcut registration or privacy IPC.

---

### Task 2: Remove selectable panel drag-hint text

**Files:**
- Modify: `desktop/ui/panel/PanelApp.tsx:57-63`
- Modify: `desktop/ui/panel/panel.css:30-33`
- Test: `tests/desktop/react_overlay.test.tsx:401-421`
- Test: `tests/desktop/test_frontend_structure.mjs:23-35`

**Interfaces:**
- Consumes: existing `.panel-drag-handle` Electron drag region and `WorkspaceMenu` header placement.
- Produces: a header containing `TRANSCRIPT` and `WorkspaceMenu` with no visible/selectable `拖动面板` element; draggable area remains owned by the header.

- [ ] **Step 1: Write failing tests for absence of the hint and preservation of the drag region**

Replace the drag-hint expectation in `tests/desktop/react_overlay.test.tsx` with:

```tsx
const header = container.querySelector('.panel-drag-handle');
const title = container.querySelector('.panel-kicker');

expect(header).toBeTruthy();
expect(header?.hasAttribute('data-drag-handle')).toBe(true);
expect(title?.textContent).toBe('TRANSCRIPT');
expect(title?.closest('.panel-drag-handle')).toBe(header);
expect(container.querySelector('.panel-drag-hint')).toBeNull();
expect(screen.queryByText('拖动面板')).toBeNull();
```

Update `tests/desktop/test_frontend_structure.mjs`:

```js
assert.match(panelApp, /className="panel-drag-handle" data-drag-handle/);
assert.doesNotMatch(panelApp, /panel-drag-hint|拖动面板/);
assert.doesNotMatch(panelCss, /\.panel-drag-hint\s*\{/);
assert.match(panelApp, /<span className="panel-kicker">TRANSCRIPT<\/span>/);
assert.match(panelApp, /<WorkspaceMenu\s*\/>/);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run from `desktop`:

```powershell
npm run unit-test -- --run ../tests/desktop/react_overlay.test.tsx
node --test ../tests/desktop/test_frontend_structure.mjs
```

Expected: both focused suites fail because `PanelApp.tsx` still renders `.panel-drag-hint` and `panel.css` still declares its rule.

- [ ] **Step 3: Remove only the hint element and obsolete CSS rule**

Change the header in `PanelApp.tsx` to:

```tsx
<header className="panel-drag-handle" data-drag-handle>
    <span className="panel-kicker">TRANSCRIPT</span>
    <WorkspaceMenu />
</header>
```

Delete only this obsolete rule from `panel.css`:

```css
.panel-drag-hint { margin-left: auto; color: rgba(235, 241, 250, 0.45); font-size: 11px; -webkit-app-region: no-drag; }
```

Keep `.panel-drag-handle` unchanged:

```css
.panel-drag-handle { display: flex; align-items: center; gap: 8px; min-height: 32px; cursor: default; -webkit-app-region: drag; }
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npm run unit-test -- --run ../tests/desktop/react_overlay.test.tsx
node --test ../tests/desktop/test_frontend_structure.mjs
npm run typecheck
```

Expected: tests pass, `拖动面板` is absent, and the header retains `data-drag-handle` and the standard cursor.

- [ ] **Step 5: Inspect and commit Task 2**

```powershell
git diff --check
git diff -- desktop/ui/panel/PanelApp.tsx desktop/ui/panel/panel.css tests/desktop/react_overlay.test.tsx tests/desktop/test_frontend_structure.mjs
git add desktop/ui/panel/PanelApp.tsx desktop/ui/panel/panel.css tests/desktop/react_overlay.test.tsx tests/desktop/test_frontend_structure.mjs
git commit -m "fix: remove panel drag hint text"
```

Expected: the commit removes only the visible hint and its stale styling; no overlay geometry or drag-controller code changes.

---

### Task 3: Apply approved option A to the capsule exit control

**Files:**
- Modify: `desktop/ui/capsule/capsule.css:195-217`
- Test: `tests/desktop/test_floating_capsule.mjs:59-79`

**Interfaces:**
- Consumes: existing `.capsule-stop` button markup in `CapsuleApp.tsx` and shared 30 px capsule control height.
- Produces: a 30 px restrained dark-red exit control with red `X`, strengthened hover state, visible focus ring, and unchanged quit wiring.

- [ ] **Step 1: Replace the solid-red token assertions with option A assertions**

Update the `.capsule-stop` assertions in `tests/desktop/test_floating_capsule.mjs`:

```js
assert.match(capsuleStop, /width:\s*30px/);
assert.match(capsuleStop, /height:\s*30px/);
assert.match(capsuleStop, /border-color:\s*rgba\(255,\s*104,\s*116,\s*0\.42\)/);
assert.match(capsuleStop, /color:\s*#ff7580/);
assert.match(capsuleStop, /background:\s*rgba\(61,\s*34,\s*43,\s*0\.72\)/);
assert.match(capsuleStop, /font-size:\s*14px/);
assert.match(capsuleStop, /font-weight:\s*700/);
assert.match(styles, /\.capsule-stop:hover\s*\{[\s\S]*?background:\s*rgba\(120,\s*48,\s*62,\s*0\.58\)/);
assert.match(styles, /\.capsule-stop:hover\s*\{[\s\S]*?border-color:\s*rgba\(255,\s*104,\s*116,\s*0\.68\)/);
assert.match(styles, /\.capsule-stop:focus-visible\s*\{[\s\S]*?outline:\s*2px\s+solid\s+#ffb3b8/);
```

Retain the existing assertions for `aria-label="退出 Meeting-Monster"`, `title="退出 Meeting-Monster"`, `>×</button>`, and `window.meetingMonster.window.quit()`.

- [ ] **Step 2: Run the focused structural test and verify RED**

Run from `desktop`:

```powershell
node --test ../tests/desktop/test_floating_capsule.mjs
```

Expected: FAIL because the current control is 34 px with a solid `#e5484d` surface, white 18 px/800 `X`, and solid-red hover.

- [ ] **Step 3: Implement option A exactly**

Replace the direct `.capsule-stop` rules in `capsule.css` with:

```css
.capsule-stop {
    display: grid;
    width: 30px;
    height: 30px;
    padding: 0;
    place-items: center;
    border-radius: 50%;
    border-color: rgba(255, 104, 116, 0.42);
    color: #ff7580;
    background: rgba(61, 34, 43, 0.72);
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
}

.capsule-stop:hover {
    background: rgba(120, 48, 62, 0.58);
    border-color: rgba(255, 104, 116, 0.68);
}

.capsule-stop:focus-visible {
    outline: 2px solid #ffb3b8;
    outline-offset: 2px;
}
```

Do not edit `CapsuleApp.tsx`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test ../tests/desktop/test_floating_capsule.mjs
npm run unit-test
npm run typecheck
```

Expected: all assertions pass, including the preserved quit callback/accessibility tests.

- [ ] **Step 5: Inspect and commit Task 3**

```powershell
git diff --check
git diff -- desktop/ui/capsule/capsule.css tests/desktop/test_floating_capsule.mjs
git add desktop/ui/capsule/capsule.css tests/desktop/test_floating_capsule.mjs
git commit -m "fix: refine capsule exit control"
```

Expected: the commit changes only exit-control styling and its focused static contract.

---

### Task 4: Full validation and unsigned Windows artifacts

**Files:**
- Verify only: all tracked implementation and test files from Tasks 1-3
- Generate, do not commit: `desktop/release/Meeting-Monster-Setup-2.2.5.exe`
- Generate, do not commit: `desktop/release/Meeting-Monster-Portable-2.2.5.exe`

**Interfaces:**
- Consumes: committed renderer/CSS changes from Tasks 1-3 and existing electron-builder configuration.
- Produces: verified source state plus fresh unsigned NSIS and portable Windows artifacts with SHA-256 hashes.

- [ ] **Step 1: Run renderer tests, type checking, and production build**

From `desktop`:

```powershell
npm run unit-test
npm run typecheck
npm run build
```

Expected: 7 Vitest files and all renderer tests pass; both renderer/main TypeScript checks exit 0; Vite and main-process builds exit 0.

- [ ] **Step 2: Run only tracked desktop Node tests**

```powershell
$trackedTests = git -C .. ls-files 'tests/desktop/*.mjs' | Where-Object { $_ -ne 'tests/desktop/audit_packaged_artifact.mjs' }
foreach ($testFile in $trackedTests) {
    $testPath = Join-Path '..' $testFile
    & node --test $testPath
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: all runnable tracked Node tests pass; the known Windows symlink-privilege case may report one explicit skip. Do not run unrelated untracked test fixtures.

- [ ] **Step 3: Build fresh unsigned Windows artifacts and audit the package**

```powershell
npm run dist:win:unsigned
npm run audit:package
```

Expected: electron-builder creates the NSIS and portable x64 EXEs; packaged-artifact audit passes and reports the inspected ASAR entry count.

- [ ] **Step 4: Record artifact sizes and SHA-256 hashes**

```powershell
$releaseDir = Join-Path (Get-Location) 'release'
foreach ($artifactName in @('Meeting-Monster-Setup-2.2.5.exe', 'Meeting-Monster-Portable-2.2.5.exe')) {
    $artifactPath = Join-Path $releaseDir $artifactName
    $artifact = Get-Item -LiteralPath $artifactPath
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath
    Write-Output "$artifactName`t$($artifact.Length)`t$($hash.Hash)"
}
```

Expected: both files exist, have non-zero sizes, and produce 64-character SHA-256 values.

- [ ] **Step 5: Verify scope and clean tracked state**

From the worktree root:

```powershell
git diff --check
git status --short
git diff --name-status b26f0cd..HEAD
```

Expected tracked implementation scope:

```text
desktop/ui/capsule/capsule.css
desktop/ui/panel/PanelApp.tsx
desktop/ui/panel/WorkspaceMenu.tsx
desktop/ui/panel/panel.css
tests/desktop/react_overlay.test.tsx
tests/desktop/test_floating_capsule.mjs
tests/desktop/test_frontend_structure.mjs
```

`desktop/release/` remains ignored and uncommitted. Pre-existing untracked `node_modules/` remains untouched. If any unexpected tracked file appears, stop and inspect it before completion.

---

## Final Review Checklist

- `显示/隐藏窗口` is visible with `Ctrl+\` but is not a button, menu item, click target, or focus target.
- `应用隐藏` retains the interactive toggle, warning dot, pending state, checked state, API call, and explanatory copy.
- `拖动面板` and `.panel-drag-hint` are absent; `.panel-drag-handle`, `data-drag-handle`, and its Electron drag CSS remain.
- Exit control uses the approved 30 px option A tokens and remains subordinate to `Chat`/`Hide`.
- Quit title, aria-label, and callback are unchanged and covered by tests.
- No shortcut registration, overlay geometry, IPC, recording, clear-chat, settings, version, or packaging configuration changes are present.
- Full tests, type checking, build, unsigned packaging, audit, and SHA-256 recording complete successfully.
