# Task 4 report — cross-window audio input preferences

## Delivered

- Added the shared `AudioInputMode` platform normalization contract and an `AudioInputSettingsStore` persisted at `userData/audio-input.json`.
- Persistence uses a UTF-8, `0600` temporary file followed by rename; malformed, missing, unsupported, or wrong-version payloads safely fall back to the platform default.
- Added typed `audioInput.get`, `set`, and `onChanged` APIs to both preload bridges and both renderer API contracts.
- Main-process IPC is restricted to live application windows, validates modes, saves before broadcasting, and sends changes to both live application windows.
- Replaced renderer-local input preference events/storage with the shared store. `WorkspaceView` performs a one-time legacy `localStorage` migration after a successful save and uses synchronized state for new recordings.
- Updated the existing SettingsView consumer to use the same typed API; no new settings UI or menu was added.

## Test-driven evidence

The new store and preload contract tests were added first and observed failing because the store module and `audioInput` namespace did not yet exist. The workspace migration/change tests also failed against the previous local-storage/event implementation. After implementation, these commands passed:

```powershell
npm --prefix desktop run build:main
node --test tests/desktop/test_audio_input_settings.mjs tests/desktop/test_preload_contract.mjs
npm --prefix desktop run unit-test
npm --prefix desktop run typecheck
```

Results: 11/11 Node tests passed; 67/67 Vitest tests passed; main build and both type-check targets passed.

## Scope and concerns

- No model, ASR protocol, capture behavior, remote API credentials, release artifacts, tags, or historical release directories were changed.
- Existing untracked release directories and `node_modules` were left untouched.

## P1 follow-up — initialization/event ordering

Review found that a delayed `audioInput.get()` snapshot could complete after an `audioInput.changed` broadcast and overwrite the newer mode. `WorkspaceView` now tracks the subscription's audio-input change generation. The initialization snapshot applies only if no broadcast arrived while it was pending; a later broadcast remains authoritative. When a broadcast supersedes a legacy migration, the stale local key is discarded because broadcasts occur only after a successful main-process save.

Added regression coverage for delayed `get()` resolving to `system` after a `microphone` change event; the rendered workspace remains `microphone`.

Fresh follow-up verification passed:

```powershell
npx --prefix desktop vitest run --root . --config desktop/vitest.config.ts tests/desktop/react_overlay.test.tsx
npx --prefix desktop vitest run --root . --config desktop/vitest.config.ts tests/desktop/react_services.test.ts
npm --prefix desktop run build:main
node --test tests/desktop/test_audio_input_settings.mjs tests/desktop/test_preload_contract.mjs
npm --prefix desktop run typecheck
```

Results: 33/33 overlay tests, 25/25 renderer-service tests, and 11/11 Node tests passed; main build and typecheck passed.
