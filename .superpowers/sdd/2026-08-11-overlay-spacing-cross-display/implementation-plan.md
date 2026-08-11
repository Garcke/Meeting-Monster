# Overlay Spacing and Cross-Display Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Chat/Hide icon-to-label spacing visibly stable and reapply the native overlay shape after cross-display drag without changing the user’s final window position.

**Architecture:** Keep the single 648×512 transparent BrowserWindow and its existing `setShape()` clipping model. Give the Ant Design button an application-owned `.capsule-button-content` flex wrapper with a real 12px gap, and add a `moved`-event synchronization path in `OverlayWindowController` that updates the anchor and replays the current shape without calling `setBounds()`.

**Tech Stack:** Electron 43.3.0, TypeScript, React, Ant Design Button, Node `node:test`, npm build/package scripts.

## Global Constraints

- Keep the current single BrowserWindow, fixed native window size, and shape-clipping architecture.
- The effective icon-to-label gap is exactly `12px` for both Chat and Hide.
- Cross-display recovery runs at the Windows `moved` event after drag completion; it does not require per-frame shape replay.
- The `moved` recovery path must not call `setBounds()` or alter the final user-selected coordinates.
- Do not split the capsule and chat panel into separate windows.
- Do not change keyboard movement, overlay state-machine behavior, transcription status, privacy behavior, or menu visuals.
- Do not stage or commit `node_modules/`, release directories, or unrelated worktree files.
- Record environment-only Electron executable `ENOENT` or symlink skips separately from regressions.

---

### Task 1: Give Chat and Hide an application-owned content wrapper

**Files:**
- Modify: `desktop/ui/capsule/CapsuleApp.tsx` — wrap each icon/label pair in `.capsule-button-content`.
- Modify: `desktop/ui/capsule/capsule.css` — apply the real 12px flex gap inside the wrapper and remove reliance on the button root gap.
- Test: `tests/desktop/test_floating_capsule.mjs` — add source/style regression assertions for both states.
- Test: `tests/desktop/test_frontend_structure.mjs` — update structure expectations to require the owned wrapper and its spacing rule.

**Interfaces:**
- Consumes: Existing Ant Design `Button`, `capsule-button` class, `capsule-chevron`, and `capsule-chat-symbol` markup.
- Produces: Both button branches render one `.capsule-button-content` element containing the SVG and its text; CSS owns `display: inline-flex`, `align-items: center`, and `gap: 12px` on that element.

- [ ] **Step 1: Write the failing structure tests**

  Add assertions that the Chat and Hide branches each contain `.capsule-button-content`, and that CSS contains an owned rule with `display: inline-flex`, `align-items: center`, and `gap: 12px`. Add an assertion that the capsule button root does not use the old `gap: 14px` as the icon-label spacing contract.

  ```js
  assert.equal((source.match(/capsule-button-content/g) ?? []).length, 2);
  assert.match(styles, /\.capsule-button-content\s*\{[\s\S]*display:\s*inline-flex[\s\S]*align-items:\s*center[\s\S]*gap:\s*12px/s);
  assert.doesNotMatch(styles, /\.capsule-button\.ant-btn\s*\{[\s\S]*gap:\s*14px/s);
  ```

- [ ] **Step 2: Run the focused tests and verify RED**

  Run from `D:\Code Project\Meeting-Monster\.worktrees\native-backend\desktop`:

  ```powershell
  npm run build
  node --test ..\tests\desktop\test_floating_capsule.mjs ..\tests\desktop\test_frontend_structure.mjs
  ```

  Expected: the new wrapper and 12px assertions fail because the current Fragment is still rendered without the project-owned wrapper and the current root rule still contains `gap: 14px`.

- [ ] **Step 3: Add the owned wrapper in both JSX branches**

  In `CapsuleApp.tsx`, change the `snapshot.target === 'workspace'` branch to:

  ```tsx
  <span className="capsule-button-content">
      <svg className="capsule-chevron" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3.5 5.25 7 8.75l3.5-3.5" />
      </svg>
      <span>Hide</span>
  </span>
  ```

  Change the Chat branch so the existing chat SVG and `Chat` label are direct children of the same wrapper:

  ```tsx
  <span className="capsule-button-content">
      <svg className="capsule-chat-symbol" viewBox="0 0 1259 1024" aria-hidden="true">
          {/* keep the existing paw path unchanged */}
      </svg>
      <span>Chat</span>
  </span>
  ```

- [ ] **Step 4: Implement the minimal CSS contract**

  Replace the root spacing contract with an explicit owned wrapper:

  ```css
  .capsule-button.ant-btn {
      gap: 0;
  }

  .capsule-button-content {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 12px;
      line-height: 1;
      white-space: nowrap;
  }
  ```

  Keep the existing 76px button width and existing icon dimensions. Retain only the direct Ant Design wrapper rule needed to make the generated outer content span participate in the button’s centered layout; do not add an Ant Design internal class dependency.

- [ ] **Step 5: Run the focused tests and verify GREEN**

  ```powershell
  npm run build
  node --test ..\tests\desktop\test_floating_capsule.mjs ..\tests\desktop\test_frontend_structure.mjs
  ```

  Expected: all tests pass and the built renderer contains both owned content wrappers.

- [ ] **Step 6: Commit the isolated spacing change**

  ```powershell
  git add desktop/ui/capsule/CapsuleApp.tsx desktop/ui/capsule/capsule.css tests/desktop/test_floating_capsule.mjs tests/desktop/test_frontend_structure.mjs
  git diff --cached --check
  git commit -m "fix: apply capsule icon label spacing inside content"
  ```

### Task 2: Reapply the current native shape after cross-display movement

**Files:**
- Modify: `desktop/src/main/overlay-window-controller.ts` — expose `moved` in the BrowserWindow-like event contract, replay the current shape after the final native move, and remove the listener during dispose.
- Test: `tests/desktop/test_single_overlay_window_controller.mjs` — cover collapsed and expanded cross-display movement, coordinate preservation, and disposal.
- Test: `tests/desktop/test_overlay_window_controller.mjs` — keep the shared fake-window contract and add the final-shape replay assertion if needed by the focused suite.

**Interfaces:**
- Consumes: Existing `BrowserWindowLike.getBounds()`, `setShape()`, `setBounds()`, `panelVisible`, `anchorFromBounds()`, `CAPSULE_SHAPE`, and `PANEL_SHAPE`.
- Produces: `BrowserWindowLike.on/removeListener('moved', listener)` support and a private `onMoved()` path that calls `setShape()` only, never `setBounds()`.

- [ ] **Step 1: Extend the fake window and write failing movement tests**

  Update the fake window type used by the controller tests so it can emit `moved`. Add tests with a final native bounds position that differs from the initial primary-display position:

  ```js
  overlay.simulateUserMove({x: 900, y: 160});
  const shapeCallsBeforeMoved = overlay.setShapeCalls.length;
  overlay.emit('moved');

  assert.equal(overlay.setShapeCalls.length, shapeCallsBeforeMoved + 1);
  assert.deepEqual(overlay.setShapeCalls.at(-1), [{x: 200, y: 0, width: 248, height: 48}]);
  assert.deepEqual(overlay.getBounds(), {x: 900, y: 160, width: 648, height: 512});
  assert.equal(overlay.setBoundsCalls.length, 0);
  ```

  Repeat after `dispatch({type: 'toggle-workspace'})` and require the last shape to contain both `CAPSULE_SHAPE` and `PANEL_SHAPE`. Add a disposal case that emits `moved` after `controller.dispose()` and asserts no new shape call.

- [ ] **Step 2: Run the controller tests and verify RED**

  Run from `D:\Code Project\Meeting-Monster\.worktrees\native-backend\desktop`:

  ```powershell
  npm run build
  node --test ..\tests\desktop\test_single_overlay_window_controller.mjs ..\tests\desktop\test_overlay_window_controller.mjs
  ```

  Expected: the new tests fail because the controller currently listens only to `move` and never replays shape on `moved`.

- [ ] **Step 3: Add the minimal moved-event synchronization**

  In `overlay-window-controller.ts`:

  1. Add `'moved'` to the `BrowserWindowLike.on()` and `removeListener()` event unions.
  2. Extract the existing shape selection into a small private `applyCurrentShape()` closure using `panelVisible`.
  3. Keep `onMove()` updating `anchor` from `anchorFromBounds(overlay!.getBounds(), true)`.
  4. Add:

  ```ts
  const onMoved = (): void => {
      if (!isAlive()) return;
      anchor = anchorFromBounds(overlay!.getBounds(), true);
      applyCurrentShape();
  };
  ```

  5. Register `overlay.on('moved', onMoved)` beside the existing `move` listener.
  6. Remove it in `dispose()` beside the existing listeners.
  7. Do not call `setBounds()` from `onMoved()`.

- [ ] **Step 4: Run the controller tests and verify GREEN**

  ```powershell
  npm run build
  node --test ..\tests\desktop\test_single_overlay_window_controller.mjs ..\tests\desktop\test_overlay_window_controller.mjs
  npm run typecheck
  ```

  Expected: movement tests, existing fixed-bound tests, and TypeScript checks pass; moved recovery adds no bounds call and preserves the final coordinates.

- [ ] **Step 5: Commit the isolated cross-display change**

  ```powershell
  git add desktop/src/main/overlay-window-controller.ts tests/desktop/test_single_overlay_window_controller.mjs tests/desktop/test_overlay_window_controller.mjs
  git diff --cached --check
  git commit -m "fix: replay overlay shape after display move"
  ```

### Task 3: Full regression, packaging, and artifact verification

**Files:**
- Modify: none unless a test exposes a regression directly caused by Tasks 1–2; any required fix must be a separate scoped commit.
- Verify: `desktop/package.json` scripts, built `desktop/dist/`, and release output directories.
- Report: `.superpowers/sdd/2026-08-11-overlay-spacing-cross-display/verification-report.md` (force-add this ignored report path only).

**Interfaces:**
- Consumes: The committed spacing and `moved` controller changes from Tasks 1–2.
- Produces: Reproducible test/build/package evidence and artifact hashes; no source API changes.

- [ ] **Step 1: Run the complete desktop test and typecheck set**

  From `D:\Code Project\Meeting-Monster\.worktrees\native-backend\desktop` run:

  ```powershell
  npm run typecheck
  npm run unit-test
  npm run build
  ```

  Expected: typecheck passes, all unit tests pass, and TypeScript emits fresh `dist/` output.

- [ ] **Step 2: Run the desktop Node regression suite**

  ```powershell
  npm run desktop-test
  ```

  Expected: all runnable tests pass. The known missing `desktop/node_modules/electron/dist/electron.exe` ENOENT cases and Windows symlink privilege skip must be listed separately if they remain; no new failures may be attributed to this change.

- [ ] **Step 3: Build unsigned Windows artifacts and audit the package**

  ```powershell
  npm run dist:win:unsigned
  npm run audit:package
  ```

  Expected: Setup and Portable installers are generated, the ASAR contains the native backend and current overlay assets, and audit passes without legacy Python backend artifacts.

- [ ] **Step 4: Run unpacked launch and cleanup smoke**

  Start the newly built unpacked Electron executable, wait for the renderer to become alive, verify there is no Python child process and no listener on port 9000, then close the app through its normal window quit path. Confirm the Meeting-Monster process tree and port 9000 listener are both gone without force-killing the app.

- [ ] **Step 5: Record evidence and hashes**

  Write `verification-report.md` with the exact commit hashes, commands and pass counts, known environment skips, artifact paths, and SHA-256 hashes. Do not include secrets or stage any release directory.

- [ ] **Step 6: Commit the verification report**

  ```powershell
  git add -f .superpowers/sdd/2026-08-11-overlay-spacing-cross-display/verification-report.md
  git diff --cached --check
  git commit -m "test: verify overlay spacing and cross-display repair"
  ```

## Self-review checklist

- Spec coverage: Task 1 covers the application-owned 12px spacing wrapper; Task 2 covers `moved` shape replay, coordinate preservation, and lifecycle cleanup; Task 3 covers full regression, packaging, audit, and manual Windows smoke.
- Placeholder scan: no unresolved placeholder marker or unspecified implementation step is used; all code-bearing steps name files, symbols, commands, and expected outcomes.
- Type consistency: the only new controller event is `moved`; it is added to both `on/removeListener` contracts and to each fake-window test emitter before registration.
- Scope: no task changes the backend, audio, menu, state machine, or multi-window architecture.
