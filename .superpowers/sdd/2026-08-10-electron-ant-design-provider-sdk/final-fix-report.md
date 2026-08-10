# Final review fix report

Date: 2026-08-10

Reviewed fix base: `f76bdefd01efcf45a634765cd64743761b9f69aa`

Scope: all four Important findings and both Minor findings from `final-review.md`.

## Outcome

- Updated the shipped runtime/build inputs to exact `electron@37.10.3` and `electron-builder@26.15.3` pins and regenerated `desktop/package-lock.json` without changing unrelated direct dependency declarations.
- Made every `BackendService.testModel` failure message a canonical, localized, secret-safe diagnostic before it crosses `ipcMain.handle`. Same-process callers retain `code` and `providerStatus`; a message-only Electron error still formats to the vision diagnostic or the HTTP-status diagnostic.
- Removed the clipped capsule quit tooltip. The Ant Design `Button`, native `title`, accessible name, capsule geometry, overflow clipping, and no-drag interaction remain intact.
- Replaced nested Ant Design `Switch` controls with single `menuitemcheckbox` rows. The rows expose checked/disabled state and support Enter-open, arrow navigation, Space/Enter activation, Escape close, and trigger-focus restoration.
- Removed the unused model-test coordinator source, its dedicated tests, unit-test script entry, and the remaining structure-test reference. Layout and ASAR guards reject a stale compiled coordinator.
- Updated both README files to describe the official SDK/main-process transport boundary and the workspace-menu privacy control.

## TDD evidence

### RED

- IPC serialization regression: stripping `InternalModelTestError.code` and `.providerStatus` by rebuilding `new Error(error.message)` caused the exhausted vision path to format as the generic `模型连接失败：请稍后重试` instead of `图片能力验证未通过：请确认模型支持图片输入`.
- Capsule popup regression: hovering the quit action found an Ant Design `role="tooltip"` under the clipped capsule shell.
- Workspace accessibility regression: `menuitemcheckbox` queries failed while nested `switch` roles were present; the new keyboard path could not address the rows as a single menu interaction.
- Dependency/layout regressions: guards observed Electron `37.2.6`, electron-builder `^26.0.12`, the obsolete unit-test entry/source, and accepted a packaged `dist/main/model-test-coordinator.js` fixture.
- Documentation guards did not find the official SDK transport or workspace-menu privacy statements.
- The first complete `desktop-test` after deleting the coordinator found one additional stale test helper that still opened `desktop/src/main/model-test-coordinator.ts`; this was removed before the final smoke rerun.

### GREEN

- Message-only vision and HTTP 401 diagnostics now preserve the canonical guidance; regression assertions also reject the API key, provider URL, model ID, and base64 image prefix.
- Capsule hover exposes no popup/tooltip path; `title` and `aria-label` remain available on the quit button.
- Transcription/privacy are `menuitemcheckbox` rows with no descendant switches. Focus enters the first enabled item, moves with arrows, activates with Space/Enter, closes with Escape, and returns to More.
- Coordinator source/test/script references are absent after a clean build, and the artifact audit rejects a stale compiled fixture.
- Focused IPC/UI suite: 2 files, 51 tests passed.
- Focused layout/artifact guards: 55 tests passed.

## Verification

| Command/check | Result |
| --- | --- |
| `npm --prefix desktop ls electron electron-builder --depth=0` | `electron@37.10.3`, `electron-builder@26.15.3` |
| `npm --prefix desktop run typecheck` | Passed |
| `npm --prefix desktop run unit-test` | 14 files, 195 tests passed (the 5 obsolete coordinator tests were removed) |
| focused `backend-service.test.ts` + `react_overlay.test.tsx` | 2 files, 51 tests passed |
| focused project/capsule/artifact guards | 55 tests passed |
| `npm --prefix desktop run build` | Passed; clean TypeScript/Vite output, no compiled coordinator |
| `npm --prefix desktop run dist:win:unsigned` | Passed with electron-builder 26.15.3 and Electron 37.10.3 |
| `npm --prefix desktop run audit:package` | Passed; 15,038 ASAR entries |
| unpacked application launch smoke | `Meeting-Monster.exe` remained alive after 5 seconds, then was terminated and cleaned up |
| `npm --prefix desktop audit --omit=dev --json` | 0 vulnerabilities |
| `npm --prefix desktop audit --json` | 5 dev-tool findings: 1 moderate, 4 high, 0 critical (down from 19: 1 critical, 17 high, 1 moderate) |
| `git diff --check` | Passed (line-ending conversion notices only) |

`npm --prefix desktop run desktop-test` rebuilt successfully and ran 240 tests: 236 passed, 3 failed, 1 skipped. The three failures are the pre-existing Electron interaction cases and all report the same missing development binary, `desktop/node_modules/electron/dist/electron.exe` (`ENOENT`). The skipped ASR symlink case reports unavailable Windows symlink privilege. The coordinator-related failure seen in the first run was fixed; its focused structure suite then passed 18/18, and the final complete rerun contains only the three known environment failures.

## Artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `desktop/release/Meeting-Monster-Setup-2.2.6.exe` | 109,248,060 | `422F59CF9D7B55A30EA0F038D3A980E37FD8EEACCBAD320720742D9750749B95` |
| `desktop/release/Meeting-Monster-Portable-2.2.6.exe` | 108,855,793 | `2A1EB60E6EA2A656540305EC4867ED7289C9684B2F4A7E134E497474DC5EC078` |
| `desktop/release/Meeting-Monster-Setup-2.2.6.exe.blockmap` | 114,588 | `E5E84CD5D9EB8D4EC53C2AB1F8DDDAC0991387C86C3B0BA70898BD45E70D01A9` |
| `desktop/release/win-unpacked/resources/app.asar` | 69,139,849 | `DB34DEB0D9A731A0F95D464FCD5538E96083C854DC517A4122C51D9FAA6A9750` |

The release output is ignored and is not staged. The pre-existing untracked root `node_modules/` is also not staged.

## Remaining concerns

1. Electron `37.10.3` is the newest Electron 37.x release and satisfies the requested supported-line constraint, but the 2026 npm advisory range is now `<39.8.9`. Consequently full audit still reports the direct Electron development dependency as high and offers Electron 43.3.0 as a semver-major fix. Moving to Electron 40+ requires a separately authorized compatibility migration; the packaged production dependency graph itself audits clean.
2. The other full-audit findings (`brace-expansion`, `nanoid`, `postcss`, and `undici`) are transitive development-tool dependencies with available upstream fixes. They do not appear in `--omit=dev`; no broad audit-fix churn was introduced in this scoped wave.
3. The development Electron binary remains incomplete in this machine's untracked `desktop/node_modules`, so the three helper-driven interaction smokes cannot run here. The actual newly packaged `win-unpacked` executable does launch successfully, and the menu/tooltip behavior is covered by focused renderer tests.
