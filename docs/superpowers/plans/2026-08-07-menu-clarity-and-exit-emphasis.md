# Menu Clarity and Exit Emphasis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Restore the screenshot-protection explanation and Ctrl+R menu hint, make the capsule quit button clearly visible, and rebuild the Windows EXE artifacts.

**Architecture:** Keep the existing menu command paths, privacy state synchronization, and application quit IPC unchanged. Add only presentational menu copy/layout and capsule exit tokens, with renderer/structure tests guarding the exact text and visual contract.

**Tech Stack:** Electron 37, React 19, TypeScript 5.9, Vite 8, Vitest 4, Node test runner, electron-builder 26.

## Global Constraints

- Preserve the existing screenshot-protection API, default state, warning dot, and status synchronization.
- Preserve Ctrl+R behavior: clear expanded Chat only; never stop transcription or reload a page.
- Preserve complete application quit behavior through window.meetingMonster.window.quit().
- Keep the dark translucent menu/capsule visual language and existing capsule/native geometry.
- Do not add dependencies, change version 2.2.5, modify settings behavior, or alter unrelated user files.
- Do not stage static/, node_modules/, desktop/release-*, or other pre-existing untracked user files.
- Build unsigned Windows NSIS and portable artifacts with npm run dist:win:unsigned.

---

### Task 1: Restore Privacy Explanation and Clear-Chat Shortcut Hint

Files:
- Modify: desktop/ui/panel/WorkspaceMenu.tsx:107-116
- Modify: desktop/ui/panel/panel.css:39-54
- Test: tests/desktop/react_overlay.test.tsx:327-370
- Test: tests/desktop/test_floating_capsule.mjs:100-116

Interfaces:
- Consumes: existing privacy state, privacy.setCaptureProtection(), and workspaceCommands.dispatch({type: 'clear-chat'}) behavior.
- Produces: exact explanatory copy and visible Ctrl+R metadata without changing command dispatch.

- [ ] Step 1: Add failing renderer assertions

Extend the existing workspace-menu test after opening the menu:

~~~ts
expect(screen.getByText('开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。')).toBeTruthy();
expect(screen.getByText('Ctrl+R')).toBeTruthy();
~~~

- [ ] Step 2: Verify RED

Run from desktop/:

~~~powershell
npm run unit-test -- --run tests/desktop/react_overlay.test.tsx
~~~

Expected: the focused renderer test fails because the explanation and Ctrl+R hint are not rendered.

- [ ] Step 3: Implement minimal markup and layout

Keep the existing clear-chat role/action and add a kbd element with Ctrl+R. Add a workspace-menu-help span under the screenshot-protection label and switch with the exact copy 开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。. Add workspace-privacy-item as a two-column grid and workspace-menu-help with grid-column 1 / -1, margin-top 3px, muted text color, 11px font size, and 1.4 line height; keep the popover at 272px.

- [ ] Step 4: Verify GREEN

~~~powershell
npm run unit-test -- --run tests/desktop/react_overlay.test.tsx
node --test ../tests/desktop/test_floating_capsule.mjs
~~~

Expected: focused renderer and menu structure tests pass, including existing privacy behavior assertions.

- [ ] Step 5: Commit

~~~powershell
git add -- desktop/ui/panel/WorkspaceMenu.tsx desktop/ui/panel/panel.css tests/desktop/react_overlay.test.tsx tests/desktop/test_floating_capsule.mjs
git commit -m "fix: restore menu guidance and shortcut hints"
~~~

---

### Task 2: Increase Exit Button Recognition

Files:
- Modify: desktop/ui/capsule/capsule.css:135-214
- Test: tests/desktop/test_floating_capsule.mjs:55-92
- Preserve: desktop/ui/capsule/CapsuleApp.tsx:72 quit handler and accessible label

Interfaces:
- Consumes: existing capsule-stop markup and window.meetingMonster.window.quit() handler.
- Produces: a 34px solid-red exit control with a readable white ×, hover state, and focus ring.

- [ ] Step 1: Add failing structural assertions

Extend the capsule structure test with assertions for capsule-stop: width 34px, height 34px, color #ffffff, background #e5484d, font-size 18px, font-weight 800, a hover background of #f2555a, and a focus-visible outline of 2px.

- [ ] Step 2: Verify RED

~~~powershell
node --test ../tests/desktop/test_floating_capsule.mjs
~~~

Expected: the old 30px translucent button tokens fail the new assertions.

- [ ] Step 3: Implement minimal CSS

Keep the JSX quit callback unchanged. Set capsule-stop to width and height 34px, background #e5484d, color #ffffff, font-size 18px, font-weight 800, line-height 1, with a light border. Set hover background #f2555a and add focus-visible outline 2px solid #ffb3b8 with outline-offset 2px. Do not change capsule bounds.

- [ ] Step 4: Verify GREEN and behavior preservation

~~~powershell
node --test ../tests/desktop/test_floating_capsule.mjs
npm run unit-test -- --run tests/desktop/react_overlay.test.tsx
~~~

Expected: structural tests and the existing exit-control-quits-the-app-instead-of-hiding-it test pass.

- [ ] Step 5: Commit

~~~powershell
git add -- desktop/ui/capsule/capsule.css tests/desktop/test_floating_capsule.mjs
git commit -m "fix: emphasize capsule exit control"
~~~

---

### Task 3: Full Verification and Windows EXE Rebuild

Files:
- Verify: tracked files changed in Tasks 1-2.
- Generate: desktop/release/Meeting-Monster-Setup-2.2.5.exe
- Generate: desktop/release/Meeting-Monster-Portable-2.2.5.exe
- Do not stage generated release artifacts.

Interfaces:
- Consumes: updated menu/capsule renderer and existing packaging configuration.
- Produces: verified unsigned NSIS and portable Windows artifacts.

- [ ] Step 1: Run renderer, type, and build checks

~~~powershell
npm run unit-test
npm run typecheck
npm run build
~~~

Expected: zero unit-test failures, zero TypeScript errors, and successful main/renderer build.

- [ ] Step 2: Run tracked desktop tests

~~~powershell
$tracked = @(git -C .. ls-files 'tests/desktop/*.mjs' | ForEach-Object { "../$_" })
node --test $tracked
~~~

Expected: zero failures; documented Windows symlink and settings-renderer environment skips may remain. This explicit tracked list avoids unrelated untracked user fixtures.

- [ ] Step 3: Build unsigned Windows artifacts

~~~powershell
npm run dist:win:unsigned
~~~

Expected files: release/Meeting-Monster-Setup-2.2.5.exe and release/Meeting-Monster-Portable-2.2.5.exe.

- [ ] Step 4: Audit and inspect artifacts

~~~powershell
npm run audit:package
Get-ChildItem release -File | Where-Object {$_.Extension -in '.exe','.blockmap'} | Select-Object Name,Length,LastWriteTime
Get-FileHash release/Meeting-Monster-Setup-2.2.5.exe -Algorithm SHA256
Get-FileHash release/Meeting-Monster-Portable-2.2.5.exe -Algorithm SHA256
~~~

Expected: package audit passes, both EXEs are non-empty, and release output remains unstaged/ignored.

- [ ] Step 5: Final scope check

~~~powershell
git status --short
git diff --check HEAD~2..HEAD
~~~

Expected: only pre-existing user untracked files and ignored build/dependency output remain.
