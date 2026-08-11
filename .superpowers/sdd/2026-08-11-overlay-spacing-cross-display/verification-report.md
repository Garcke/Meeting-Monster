# Overlay spacing and cross-display repair verification

Verified on 2026-08-11 in `D:\Code Project\Meeting-Monster\.worktrees\native-backend` at source commits `2015012` and `d09e986` (not rewritten).

## Commands and results

All commands below were run from `desktop` unless otherwise stated.

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS (exit 0) | Renderer and main TypeScript no-emit checks completed. |
| `npm run unit-test` | PASS (exit 0) | 14 test files passed; 195/195 tests passed. |
| `npm run build` | PASS (exit 0) | Main TypeScript compile and Vite renderer build completed (1,742 modules transformed). |
| `npm run desktop-test` | EXPECTED ENVIRONMENT LIMITATION (exit 1) | 241 passed, 3 failed, 1 skipped, 245 total. See separate classifications below. The command rebuild completed first. |
| `npm run dist:win:unsigned` | PASS (exit 0) | Produced unsigned x64 NSIS Setup and Portable artifacts. |
| `npm run audit:package` | PASS (exit 0) | `Packaged artifact audit passed (15038 ASAR entries).` |

### Desktop-test classifications

Known Electron executable environment failures (3; all are the expected `desktop/node_modules/electron/dist/electron.exe` `spawn ... ENOENT`):

1. `renderer-global wheel delivery does not hide a settings-main regression as an environment skip`
2. `settings-main wheel delivery without scrolling remains an ordinary interaction failure`
3. `Electron settings view accepts wheel scrolling and pointer focus`

Windows privilege skip (1): `symlinked required files are not reused as installed models` — `Windows symlink privilege is unavailable`.

No other desktop-test failures were observed.

## Packaging and artifact contents

The package audit examined one Windows ASAR (`release\\win-unpacked\\resources\\app.asar`) containing 15,038 entries. A direct ASAR listing found 13 `dist\\backend` entries, four current overlay asset entries (`overlay.html`, overlay asset bundle(s), and/or `recorder_worklet.js`), and zero legacy Python/backend artifact matches (`python`, `server`, `web`, `asr`, `models`, `weights`, `.venv`, `.py`, `.pyc`, `.onnx`, `.pt`, or `.bin`). The audit also passed its native-runtime and forbidden-artifact checks.

| Artifact | SHA-256 |
| --- | --- |
| `desktop\\release\\Meeting-Monster-Setup-2.2.6.exe` | `7A7A643DAE04E7E5E24BE4E30AAC1106760620FDF0E0A2D384D338A31B88C6A2` |
| `desktop\\release\\Meeting-Monster-Portable-2.2.6.exe` | `0A31C477B120D4C599320572A2E1E6AB93502F5B172145AB9BBDB3696C9077E7` |

Hashes were obtained with `Get-FileHash -Algorithm SHA256`.

## Unpacked launch and normal-close smoke

Launched `desktop\\release\\win-unpacked\\Meeting-Monster.exe` with no prior Meeting-Monster root process. After six seconds: process tree count was 3, including one `--type=renderer` process; Python-child count was 0; and `Get-NetTCPConnection -LocalPort 9000` returned 0 listeners. `CloseMainWindow()` returned `True`. After normal close, the Meeting-Monster process-tree count was 0 and the port-9000 listener count remained 0.

## Repository hygiene

`git diff --check` was run before commit. Only this report is staged for the verification commit. The pre-existing untracked root `node_modules/` and generated `desktop/release/` artifacts are not staged or committed.
