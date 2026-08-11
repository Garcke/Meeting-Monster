# Final native backend review fix report

Date: 2026-08-11 (Asia/Shanghai)

Base HEAD: `0df08896b3f384aaf2544c4de3a9aa59b99177b9`

Commit: `fix: address final native backend review findings`. The final SHA is reported in the task handoff rather than embedded here because this report is part of that commit (embedding the commit's own SHA is not stable).

## Scope and implementation

### 1. Secure provider URL policy

- Added `desktop/src/shared/provider-url-policy.ts` and routed both `validateBackendSelection` and `validateModelConnection` through it.
- Remote providers require `https:`. Plain `http:` is accepted only for `localhost`, `127.0.0.1`, and `::1`, including local ports.
- Credentials, queries, fragments, unsupported protocols, empty/malformed values are rejected.
- Successful values use `URL.href` normalization and remove trailing slashes.

RED evidence:

- `npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/types-and-validation.test.ts`: 1 failed / 14 passed because `http://provider.example/v1` did not throw.
- `node --test tests/desktop/test_model_connection_settings.mjs`: 1 failed / 29 passed because remote HTTP did not throw.

GREEN evidence:

- Focused backend validation: 15/15 passed.
- Focused model settings: 30/30 passed.
- Focused `npm run typecheck`: exit 0.

### 2. Sender-scoped chat cancellation

- Added the pure `cancelChatRequestsForSender` helper.
- Matching requests are deleted, their outer `AbortController` is aborted, and their backend request ID is canceled. Other senders are untouched.
- Overlay `render-process-gone` and `closed` hooks invoke the helper. The existing sanitized renderer-exit broadcast and quit behavior remain.

RED evidence:

- Unit test initially failed module resolution before the new helper existed.
- `node --test tests/desktop/test_main_structure.mjs`: 1 failed / 18 passed because neither lifecycle hook invoked sender cancellation.

GREEN evidence:

- Focused sender cancellation unit test: 1/1 passed.
- Main source/integration structure tests: 19/19 passed.
- Focused `npm run typecheck`: exit 0.

### 3. Ant Design Select Electron harness

- The settings harness now waits for the `API 协议` and `识别模型` accessible comboboxes.
- It opens each visible AntD Select with native pointer input, counts role-options belonging to the active visible dropdown (2 each), and closes it through the next visible settings navigation control.
- Existing `modelOptions` / `asrOptions`, wheel delivery, scrolling, focus, and environment classification remain.
- `test_overlay_interaction.mjs` accepts `MEETING_MONSTER_ELECTRON_EXE` so an externally installed Electron can run the worktree without modifying its incomplete `node_modules`.

RED evidence:

- Structural assertion initially failed on stale `#modelProtocol option` / `#asrModelSelect option` selectors.
- First real Electron execution reached an open AntD Select (`aria-expanded=true`, 2 role-options) but failed the old visibility/close assumptions, proving the interaction path rather than a presence-only check.

GREEN evidence:

- Structural assertion and `node --check tests/desktop/settings-interaction-electron.cjs`: exit 0.
- Real external Electron execution against the fresh worktree build returned:

  `SETTINGS_INTERACTION_RESULT {"modelsVisible":true,"speechVisible":true,"scrollHeight":698,"clientHeight":180,"scrolled":1.600000023841858,"focusedId":"modelApiKey","modelOptions":2,"asrOptions":2}`

- Complete desktop suite passed with the external executable override. In the parallel full run, the positive native-wheel case was correctly classified as environment-unavailable when competing Electron windows prevented native wheel delivery; both negative wheel-classification tests passed. The standalone real result above verifies the positive interaction.

### 4. Overlay cleanup and cross-display coverage

- `OverlayWindowController` removes `move`, `moved`, and `closed` listeners inside the `closed` callback even after Electron reports the window destroyed. `dispose` shares the same cleanup path.
- Added negative monitor coordinates and a `moved` then `moveBy` sequence. Shape replay keeps native bounds unchanged before the explicit move.

RED evidence:

- Focused controller run: 1 failed / 13 passed; destroyed fake window retained one `move` listener (and the other lifecycle listeners).

GREEN evidence:

- Focused controller run: 14/14 passed; all three listener counts are zero after destroy, and negative-coordinate movement remains stable.

## Two-display unpacked Windows smoke

The system exposed two actual displays to Electron:

- Primary: `1536x864`, work area `1536x816`, scale factor `1.25`, origin `(0,0)`.
- Secondary: `1920x1080`, work area `1920x1032`, scale factor `1.0`, origin `(1536,-216)`.

The worktree's `desktop/node_modules/electron` package lacked `dist/electron.exe`. To avoid touching `node_modules`, the smoke used `D:\Code Project\Meeting-Monster\desktop\node_modules\electron\dist\electron.exe` solely as an external runner for this worktree's freshly built unpacked files.

Corrected smoke result (exit 0):

- Collapsed on both displays: button text `Chat`, capsule visible, panel hidden.
- Expanded on both displays: button text `Hide`, capsule and panel visible.
- Secondary bounds before/after Chat: `{x:2172,y:-136,width:648,height:512}`; `chatChangedBounds=false`.
- Primary bounds before/after Hide: `{x:444,y:80,width:648,height:512}`; `hideChangedBounds=false`.
- Actual `capturePage()` PNG payloads were non-empty: 10,351 bytes collapsed and 37,623 bytes expanded.

Limitation: the smoke supplies actual BrowserWindow, cross-display, mixed-scale, DOM visibility, bounds, shape-lifecycle, and non-empty capture evidence, but no independent human screenshot review was available. Therefore this report does not claim final native DPI visual acceptance.

## Full verification

- `npm run typecheck`: exit 0.
- `npm run unit-test`: 15 test files, 200 tests passed, 0 failed.
- `npm run build`: exit 0; main TypeScript and Vite renderer builds completed.
- `$env:MEETING_MONSTER_ELECTRON_EXE='D:\Code Project\Meeting-Monster\desktop\node_modules\electron\dist\electron.exe'; npm run desktop-test`: exit 0; 249 tests, 247 passed, 0 failed, 2 skipped (Windows symlink privilege; concurrent native-wheel environment classification).
- `git diff --check`: exit 0.

## Files in the fix commit

- `desktop/src/shared/provider-url-policy.ts`
- `desktop/src/backend/validation.ts`
- `desktop/src/main/model-connection-settings.ts`
- `desktop/src/main/chat-request-cancellation.ts`
- `desktop/src/main/main.ts`
- `desktop/src/main/overlay-window-controller.ts`
- `tests/desktop/backend/types-and-validation.test.ts`
- `tests/desktop/backend/chat-request-cancellation.test.ts`
- `tests/desktop/test_model_connection_settings.mjs`
- `tests/desktop/test_main_structure.mjs`
- `tests/desktop/settings-interaction-electron.cjs`
- `tests/desktop/test_overlay_interaction.mjs`
- `tests/desktop/test_overlay_window_controller.mjs`
- `tests/desktop/test_single_overlay_window_controller.mjs`
- `.superpowers/sdd/2026-08-11-overlay-spacing-cross-display/final-fix-report.md`

Pre-existing untracked root `node_modules/` was not modified, staged, or committed. No release artifacts or packaging configuration were changed.
