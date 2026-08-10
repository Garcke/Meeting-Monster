# Electron 43 runtime security upgrade

Date: 2026-08-10

Scope: resolve the final-release blocking shipped Electron runtime vulnerability without changing application behavior.

## Root cause and version choice

- `electron@37.10.3` was packaged into the Windows artifacts even though it is declared as a development dependency. The full npm audit therefore correctly reported the runtime as a direct high-severity release risk.
- The audit's direct remediation is `electron@43.3.0`; the npm registry reports it as the current latest release. Electron 39 is EOL, so upgrading only to the advisory's first patched 39.x version would not provide a supported release line.
- Electron 43 requires Node `>=22.12.0`. The verification environment is Node `v24.16.0`; no source compatibility changes were required.

## TDD evidence

1. Changed the existing project-layout runtime-version guard to require `electron@43.3.0`.
2. With `desktop/package.json` still pinned to `37.10.3`, `node --test tests/desktop/test_project_layout.mjs` failed exactly at the Electron version assertion (`37.10.3 !== 43.3.0`).
3. Updated only the Electron direct pin and lockfile via `npm --prefix desktop install --save-dev --save-exact electron@43.3.0`.
4. The same project-layout test then passed 12/12.

## Changes

- `desktop/package.json`: exact Electron runtime pin `37.10.3` -> `43.3.0`.
- `desktop/package-lock.json`: regenerated dependency metadata for Electron 43's downloader/runtime package graph.
- `tests/desktop/test_project_layout.mjs`: protects the shipped runtime pin against accidental downgrade.

## Verification

| Check | Result |
| --- | --- |
| `npm --prefix desktop ls electron electron-builder --depth=0` | `electron@43.3.0`, `electron-builder@26.15.3` |
| project-layout regression | 12/12 passed after upgrade; observed RED before it |
| `npm --prefix desktop run typecheck` | Passed |
| `npm --prefix desktop run unit-test` | 14 files, 195 tests passed |
| `npm --prefix desktop run desktop-test` | 236 passed, 3 environment-only Electron interaction ENOENTs, 1 Windows symlink privilege skip |
| `npm --prefix desktop run dist:win:unsigned` | Passed; electron-builder downloaded and packaged Electron 43.3.0 |
| `npm --prefix desktop run audit:package` | Passed; 15,038 ASAR entries |
| unpacked launch/cleanup smoke | Passed; `Meeting-Monster.exe` alive after 5 seconds, then stopped with no smoke-started root process left |
| `npm --prefix desktop audit --omit=dev --json` | 0 findings |
| full `npm --prefix desktop audit --json` | 4 dev-only transitive findings (3 high, 1 moderate); no `electron` finding |
| `git diff --check` | Passed |

The three desktop-test failures still all attempt to spawn the missing development-only binary at `desktop/node_modules/electron/dist/electron.exe`; the independently downloaded and packaged `release/win-unpacked/Meeting-Monster.exe` did launch successfully. The remaining full-audit findings are development-only transitive `brace-expansion`, `nanoid`, `postcss`, and `undici`; they do not occur with `--omit=dev` and are outside this runtime-only upgrade scope.

## Windows artifacts

| Artifact | SHA-256 |
| --- | --- |
| `release/Meeting-Monster-Setup-2.2.6.exe` | `4382F15F0C6D340A5E3A1EBD27267332C8DF3F31FDD0C3E61E047B2FFCF3B103` |
| `release/Meeting-Monster-Portable-2.2.6.exe` | `038E7F65D48585265D3BD8A105F71BBF9D28710F9E4D7123C04C484F7D981E6B` |
| `release/win-unpacked/resources/app.asar` | `DB34DEB0D9A731A0F95D464FCD5538E96083C854DC517A4122C51D9FAA6A9750` |

Release outputs and untracked `node_modules/` remain unstaged.
