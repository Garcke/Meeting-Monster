# Electron Native Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python/FastAPI model backend with TypeScript modules running inside the Electron main process so the packaged EXE provides AI functionality immediately without Python, a local server, or a manual startup command.

**Architecture:** The renderer keeps its existing allowlisted IPC surface. Electron main owns a `BackendService` that validates model selections, stores conversation state, streams directly to OpenAI-Compatible or Anthropic-Compatible providers with Node `fetch`, runs vision verification, and disposes all requests before quit. No child process and no `127.0.0.1:9000` listener are introduced.

**Tech Stack:** TypeScript 5.9, Electron 37, Node 22 runtime APIs (`fetch`, `AbortController`, `zlib`), React renderer, Vitest, Node test runner, Electron Builder.

## Global Constraints

- The released EXE and portable build must work without Python, a virtual environment, `start.bat`, or a separately started service.
- Only OpenAI Compatible and Anthropic Compatible protocols remain supported.
- API Keys remain encrypted by the existing Electron `safeStorage`-backed `ModelConnectionStore` and never cross the renderer boundary.
- Provider failures, API Keys, authorization values, provider URLs with credentials, model names, and screenshot data must be sanitized before renderer events or logs.
- No ASR model weights, Python files, Python runtime, virtual environment, or model artifacts may enter a release artifact.
- Local ASR remains Electron-native and is not part of this migration.
- Each production behavior is implemented test-first: write a failing test, run it, implement the smallest passing change, rerun focused tests, then run the relevant regression suite.
- Do not stage existing untracked files or release directories with `git add -A`; stage only the paths named by each task.

---

## File Map

### New backend modules

- `desktop/src/backend/types.ts` — backend-only message, selection, provider, stream, diagnostic, and test-result types.
- `desktop/src/backend/validation.ts` — strict model-selection, image, and request validation; sensitive-text collection and redaction.
- `desktop/src/backend/sse.ts` — incremental SSE parser shared by both provider implementations.
- `desktop/src/backend/providers/provider.ts` — provider interface and normalized provider error shape.
- `desktop/src/backend/providers/openai-provider.ts` — OpenAI Chat Completions-compatible HTTP streaming.
- `desktop/src/backend/providers/anthropic-provider.ts` — Anthropic Messages-compatible HTTP streaming.
- `desktop/src/backend/providers/provider-cache.ts` — bounded cache and disposal of provider instances.
- `desktop/src/backend/conversation-store.ts` — single-user system/user/assistant history with reset and commit rules.
- `desktop/src/backend/chat-service.ts` — serialized streaming chat orchestration and cancellation semantics.
- `desktop/src/backend/chat-images.ts` — PNG-only image validation and provider-specific image message construction.
- `desktop/src/backend/vision-challenge.ts` — deterministic pure-JavaScript PNG generation, answer parsing, and provider vision verification.
- `desktop/src/backend/model-diagnostics.ts` — fixed diagnostic codes, safe messages, and status/type classification.
- `desktop/src/backend/backend-service.ts` — the single main-process backend façade used by IPC.

### Modified desktop files

- `desktop/src/main/main.ts` — instantiate `BackendService`, route model/chat IPC to it, reset backend history on `clear-chat`, and await disposal during quit.
- `desktop/src/main/model-test-coordinator.ts` — depend on backend service test callbacks instead of the local HTTP client where needed.
- `desktop/src/shared/contracts.ts` — keep the public IPC DTOs stable and add only the cancellation/disposal types needed by the direct backend.
- `desktop/src/preload/index.ts` — retain the current safe API shape; update only types if a contract changes.
- `desktop/src/preload/settings.ts` — retain the current safe settings API shape; update only types if a contract changes.
- `desktop/src/main/remote-api-client.ts` — delete after all direct provider behavior has moved to `desktop/src/backend/`.
- `desktop/package.json` — include new backend tests in the unit-test command and keep runtime dependencies pure JavaScript/Node built-ins.
- `desktop/README.md` — document that the Electron application includes the backend and no Python service is required.
- `README.md` — replace Python startup instructions with Electron-only backend behavior.
- `tests/desktop/test_main_structure.mjs` — assert direct backend initialization, IPC routing, and quit disposal.
- `tests/desktop/test_project_layout.mjs` — assert the TypeScript backend boundary and remove assertions that forbid all backend source.
- `tests/desktop/test_packaging_config.mjs` — assert backend output is included through `dist/**/*` and no Python packaging hooks exist.
- `tests/desktop/audit_packaged_artifact.mjs` — allow `dist/backend/**` while continuing to reject Python and model entries.
- `tests/desktop/backend/*.test.ts` — focused Vitest coverage for the new backend modules.

### Deleted after migration verification

- `server/app.py`
- `server/chat_images.py`
- `server/chat_service.py`
- `server/llm_api.py`
- `server/llm_providers.py`
- `server/model_api.py`
- `server/model_diagnostics.py`
- `server/vision_challenge.py`
- `server/settings/__init__.py`
- `server/settings/model_profiles.py`
- `server/settings/profile_store.py`
- `server/config/default_model_profiles.json` after equivalent TypeScript defaults are covered
- `server/assets/fonts/LICENSE_DEJAVU`
- `server/assets/fonts/DejaVuSansMono-Bold.ttf`
- `server/__init__.py`
- `server/requirements.txt`
- `requirements-dev.txt`
- `start.bat`

---

## Task 1: Establish backend contracts and test harness

**Files:**
- Create: `desktop/src/backend/types.ts`
- Create: `desktop/src/backend/validation.ts`
- Create: `tests/desktop/backend/types-and-validation.test.ts`
- Modify: `desktop/package.json`

**Interfaces:**

```ts
export type BackendProtocol = 'openai' | 'anthropic';
export type BackendProfileId = 'generic_openai' | 'generic_anthropic';

export interface BackendModelSelection {
    profile_id: BackendProfileId;
    protocol: BackendProtocol;
    base_url: string;
    model: string;
    api_key?: string;
    max_tokens: number;
    temperature?: number | null;
}

export interface BackendImage {
    media_type: 'image/png';
    data: string;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    image?: BackendImage;
}

export type BackendChatEvent =
    | {type: 'chunk'; text: string}
    | {type: 'error'; text: string}
    | {type: 'done'};

export interface BackendProvider {
    readonly key: string;
    streamText(messages: readonly ChatMessage[], signal: AbortSignal): AsyncGenerator<string>;
    dispose(): Promise<void>;
}
```

- [ ] **Step 1: Write the failing validation tests.** Cover unknown fields, invalid profile/protocol pairs, empty model IDs, query/fragment-bearing base URLs, unsupported image media types, empty image data, and valid OpenAI/Anthropic selections.

```ts
it('rejects a selection with an unsupported field', () => {
    expect(() => validateBackendSelection({...validSelection, unexpected: true})).toThrow(/unsupported field/i);
});

it('accepts a complete fixed protocol selection', () => {
    expect(validateBackendSelection(validSelection)).toEqual({
        ...validSelection,
        base_url: 'https://provider.example/v1',
    });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module is missing.**

Run: `Set-Location desktop; npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/types-and-validation.test.ts`

Expected: FAIL with an import/export or missing-function error, not a passing test.

- [ ] **Step 3: Implement the minimal contracts and validators.** Reuse the existing `validateModelSelectionInput` rules from `remote-api-client.ts`, but return backend-owned types and reject all unknown fields before any network call.

- [ ] **Step 4: Run the focused test again.**

Run: `Set-Location desktop; npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/types-and-validation.test.ts`

Expected: PASS with all new validation cases green.

- [ ] **Step 5: Add the new backend test file to `desktop/package.json`'s `unit-test` script and commit.**

```powershell
git add desktop/src/backend/types.ts desktop/src/backend/validation.ts tests/desktop/backend/types-and-validation.test.ts desktop/package.json
git commit -m "feat: add native backend contracts and validation"
```

## Task 2: Implement shared SSE and provider error handling

**Files:**
- Create: `desktop/src/backend/sse.ts`
- Create: `desktop/src/backend/providers/provider.ts`
- Create: `desktop/src/backend/model-diagnostics.ts`
- Create: `tests/desktop/backend/sse-and-diagnostics.test.ts`

**Interfaces:**

```ts
export interface SseEvent {
    event: string;
    data: string;
}

export async function* parseSse(response: Response, signal: AbortSignal): AsyncGenerator<SseEvent>;

export interface NormalizedProviderError {
    status?: number;
    kind: 'authentication' | 'not_found' | 'invalid_request' | 'rate_limited' | 'timeout' | 'unreachable' | 'upstream' | 'unknown';
    message: string;
}

export function classifyProviderError(error: unknown): NormalizedProviderError;
export function sanitizeProviderError(error: unknown, selection: BackendModelSelection, image?: BackendImage): string;
```

- [ ] **Step 1: Write failing SSE tests for fragmented UTF-8/CRLF chunks, comments, multiple events, `data:` lines, `[DONE]`, and abort signals.** Use a `ReadableStream<Uint8Array>` response so the parser is tested against real chunk boundaries rather than a mock callback.

- [ ] **Step 2: Run the focused test and verify the parser is absent or fails.**

Run: `Set-Location desktop; npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/sse-and-diagnostics.test.ts`

- [ ] **Step 3: Implement the incremental parser with `TextDecoder`, a line buffer, blank-line event boundaries, and immediate `AbortSignal` checks.** Do not persist image data or provider response bodies in a module-level secret collection.

- [ ] **Step 4: Add failing diagnostic tests.** Assert 401/403 → `authentication`, 404 → `not_found`, 400/422 → `invalid_request`, 429 → `rate_limited`, 408/504 → `timeout`, 5xx → `upstream`, network errors → `unreachable`, and unknown errors → `unknown`; assert secret strings never appear in sanitized output.

- [ ] **Step 5: Implement fixed user-facing diagnostic messages and secret replacement.** Preserve the current safe-message behavior from `model_diagnostics.py` and `remote-api-client.ts`, without returning upstream response text.

- [ ] **Step 6: Run the focused suite and commit.**

```powershell
Set-Location desktop
npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/sse-and-diagnostics.test.ts
git add src/backend/sse.ts src/backend/providers/provider.ts src/backend/model-diagnostics.ts ../tests/desktop/backend/sse-and-diagnostics.test.ts
git commit -m "feat: add native backend SSE and diagnostics"
```

## Task 3: Add direct OpenAI and Anthropic providers

**Files:**
- Create: `desktop/src/backend/providers/openai-provider.ts`
- Create: `desktop/src/backend/providers/anthropic-provider.ts`
- Create: `desktop/src/backend/providers/provider-cache.ts`
- Create: `tests/desktop/backend/providers.test.ts`

**Interfaces:**

```ts
export type BackendFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createOpenAiProvider(selection: BackendModelSelection, fetcher?: BackendFetch): BackendProvider;
export function createAnthropicProvider(selection: BackendModelSelection, fetcher?: BackendFetch): BackendProvider;

export class ProviderCache {
    constructor(factory: (selection: BackendModelSelection) => BackendProvider, maxEntries?: number);
    get(selection: BackendModelSelection): BackendProvider;
    dispose(): Promise<void>;
}
```

- [ ] **Step 1: Write failing OpenAI provider tests.** Assert `POST <base_url>/chat/completions`, bearer authentication, JSON fields (`model`, `messages`, `stream`, `max_tokens`, optional temperature), PNG data-URL serialization, streamed `choices[0].delta.content`, and propagation of the supplied `AbortSignal`.

- [ ] **Step 2: Run the tests and confirm they fail before provider modules exist.**

Run: `Set-Location desktop; npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/providers.test.ts`

- [ ] **Step 3: Implement OpenAI streaming with native `fetch` and `parseSse`.** Build the endpoint by joining the validated base URL with `chat/completions`; never append provider credentials to the URL.

- [ ] **Step 4: Write failing Anthropic provider tests.** Assert `POST <base_url>/messages`, `x-api-key`, `anthropic-version`, separated system text, user/assistant conversation messages, PNG base64 source, and `content_block_delta` text extraction.

- [ ] **Step 5: Implement Anthropic streaming with native `fetch` and `parseSse`.** Return only text deltas and classify non-2xx responses through `classifyProviderError`.

- [ ] **Step 6: Write failing ProviderCache tests.** Assert equivalent selections reuse a provider, the least-recently-used entry is disposed when the cap is exceeded, and `dispose()` releases every entry exactly once.

- [ ] **Step 7: Implement the bounded cache and run the focused provider suite.**

Run: `Set-Location desktop; npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/providers.test.ts`

Expected: PASS; no external provider network request is made by the tests.

- [ ] **Step 8: Commit the providers.**

```powershell
git add desktop/src/backend/providers tests/desktop/backend/providers.test.ts
git commit -m "feat: add native OpenAI and Anthropic providers"
```

## Task 4: Port image validation and conversation state

**Files:**
- Create: `desktop/src/backend/chat-images.ts`
- Create: `desktop/src/backend/conversation-store.ts`
- Create: `desktop/src/backend/chat-service.ts`
- Create: `tests/desktop/backend/chat-service.test.ts`

**Interfaces:**

```ts
export function parseBackendImage(value: unknown): BackendImage;

export class ConversationStore {
    constructor(initialSystemPrompt?: string);
    setPrompt(prompt: string): void;
    reset(): void;
    snapshot(): readonly ChatMessage[];
    appendUser(content: string, image?: BackendImage): readonly ChatMessage[];
    commitAssistant(content: string): void;
}

export interface ChatServiceOptions {
    providers: ProviderCache;
    history?: ConversationStore;
}

export class ChatService {
    stream(content: string, selection: BackendModelSelection, signal: AbortSignal, image?: BackendImage): AsyncGenerator<BackendChatEvent>;
    reset(): void;
    dispose(): Promise<void>;
}
```

- [ ] **Step 1: Write failing image tests for PNG-only valid input, empty data, wrong media type, extra fields, and data URL conversion for both protocols.**

- [ ] **Step 2: Implement `parseBackendImage` and provider-specific message serializers; run the image tests to green.**

- [ ] **Step 3: Write failing conversation tests.** Assert system prompt ordering, user message append before streaming, assistant message commit only on normal completion with text, no partial assistant commit on error/abort, and reset clearing all messages.

- [ ] **Step 4: Implement `ConversationStore` with immutable snapshots and an async-exclusive chat lock in `ChatService`.**

- [ ] **Step 5: Write failing `ChatService` tests.** Use a real fake `BackendProvider` that yields chunks and throws/observes abort. Assert event order `chunk* → done`, error then done for provider failures, and no concurrent conversation mutation.

- [ ] **Step 6: Implement `ChatService.stream`, mapping provider errors to sanitized `error` events and always emitting one terminal `done` unless the caller aborts.**

- [ ] **Step 7: Run the focused suite and commit.**

```powershell
Set-Location desktop
npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/chat-service.test.ts
git add src/backend/chat-images.ts src/backend/conversation-store.ts src/backend/chat-service.ts ../tests/desktop/backend/chat-service.test.ts
git commit -m "feat: port native chat history and streaming service"
```

## Task 5: Port vision challenge generation and verification

**Files:**
- Create: `desktop/src/backend/vision-challenge.ts`
- Create: `tests/desktop/backend/vision-challenge.test.ts`

**Interfaces:**

```ts
export interface VisionChallenge {
    code: string;
    image: BackendImage;
}

export function createVisionChallenge(random?: () => number): VisionChallenge;
export function extractVisionCode(answer: string): string | null;
export async function verifyProviderVision(provider: BackendProvider, challenge: VisionChallenge, signal: AbortSignal): Promise<boolean>;
```

- [ ] **Step 1: Write failing tests for four-digit code generation, PNG signature, JSON answer parsing, fenced JSON parsing, exact bare-digit parsing, rejection of extra alphanumeric digits, and provider streaming verification.** Inject a deterministic random function so tests never depend on randomness.

- [ ] **Step 2: Run the focused suite and verify the generator/parser is missing.**

Run: `Set-Location desktop; npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/vision-challenge.test.ts`

- [ ] **Step 3: Implement a small bitmap digit renderer and PNG encoder using `Buffer`, `zlib.deflateSync`, and CRC-32.** Render a 360×88 RGB image, base64-encode the PNG, and return it as `image/png`; do not add Pillow, a native image package, or a model asset.

- [ ] **Step 4: Implement strict `extractVisionCode` rules matching the Python behavior: accept `{"code":"1234"}` with optional JSON fences or exactly four standalone digits, reject empty/malformed/more-than-four/alphanumeric-adjacent answers.**

- [ ] **Step 5: Implement `verifyProviderVision` with the fixed prompt, a 128-character cap, abort propagation, and equality comparison against the challenge code.**

- [ ] **Step 6: Run the focused suite and commit.**

```powershell
git add desktop/src/backend/vision-challenge.ts tests/desktop/backend/vision-challenge.test.ts
git commit -m "feat: add native vision challenge verification"
```

## Task 6: Build the main-process BackendService façade

**Files:**
- Create: `desktop/src/backend/backend-service.ts`
- Create: `tests/desktop/backend/backend-service.test.ts`
- Modify: `desktop/src/main/model-connection-settings.ts` only if a typed adapter is required

**Interfaces:**

```ts
export interface BackendServiceOptions {
    connectionStore: ModelConnectionStore;
    fetcher?: BackendFetch;
    providerFactory?: (selection: BackendModelSelection, fetcher: BackendFetch) => BackendProvider;
    visionVerifier?: (provider: BackendProvider, challenge: VisionChallenge, signal: AbortSignal) => Promise<boolean>;
}

export class BackendService {
    constructor(options: BackendServiceOptions);
    listModelOptions(): Promise<ModelOptions>;
    streamChat(requestId: string, content: string, selection?: BackendModelSelection, image?: BackendImage): AsyncGenerator<BackendChatEvent>;
    testModel(selection: BackendModelSelection, onProgress?: (progress: ModelTestProgress) => void): Promise<ModelTestResult>;
    resetConversation(): void;
    cancel(requestId: string): boolean;
    dispose(): Promise<void>;
}
```

- [ ] **Step 1: Write failing façade tests.** Assert saved connection merge behavior, default protocol options without a network request, `streamChat` request registration and cancellation, `testModel` progress transitions, vision failure classification, and disposal rejecting new work.

- [ ] **Step 2: Run the focused suite and confirm the façade is absent.**

Run: `Set-Location desktop; npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/backend-service.test.ts`

- [ ] **Step 3: Implement selection resolution through the existing `ModelConnectionStore`.** A supplied selection inherits a saved API Key only when profile ID, protocol, base URL, and model identity match; an omitted selection uses the active saved connection; missing configuration produces a controlled error.

- [ ] **Step 4: Implement `streamChat` with a request map keyed by `requestId`, `AbortController`, `ChatService`, and provider cache.** Reject duplicate IDs and remove entries in `finally`.

- [ ] **Step 5: Implement `testModel` with a short, zero-temperature selection, progress callbacks (`starting`, `streaming`, `verifying`, `complete`, `error`), `verifyProviderVision`, safe diagnostics, and latency measurement.

- [ ] **Step 6: Implement `resetConversation`, `cancel`, and idempotent `dispose`; after disposal all new operations fail before network access and all providers are released.

- [ ] **Step 7: Run the focused suite and commit.**

```powershell
Set-Location desktop
npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/backend-service.test.ts
git add src/backend/backend-service.ts ../tests/desktop/backend/backend-service.test.ts
git commit -m "feat: add Electron main-process backend service"
```

## Task 7: Replace the local HTTP client in Electron IPC

**Files:**
- Modify: `desktop/src/main/main.ts:52,449-451,559-598,819-928,1020-1035,1222-1228`
- Modify: `desktop/src/main/model-test-coordinator.ts`
- Modify: `desktop/src/shared/contracts.ts` only when the existing DTO types cannot express backend progress/events
- Modify: `desktop/src/preload/index.ts` and `desktop/src/preload/settings.ts` only when corresponding DTO types change
- Create: `tests/desktop/backend/main-lifecycle.test.ts`
- Modify: `tests/desktop/test_main_structure.mjs`

- [ ] **Step 1: Write failing lifecycle tests around an extracted pure helper.** The helper must call `dispose()` once, reject new backend work after disposal starts, and resolve a second quit request without disposing twice.

```ts
it('disposes the backend once before the application exits', async () => {
    const calls: string[] = [];
    const lifecycle = createBackendLifecycle({
        dispose: async () => { calls.push('dispose'); },
    });
    await lifecycle.disposeForQuit();
    await lifecycle.disposeForQuit();
    expect(calls).toEqual(['dispose']);
});
```

- [ ] **Step 2: Run the lifecycle test and confirm the helper is missing.**

Run: `Set-Location desktop; npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/main-lifecycle.test.ts`

- [ ] **Step 3: Implement the helper and add `BackendService` initialization in `startApplication()` after the model connection store is created and before IPC registration.** Remove `DEFAULT_BACKEND_URL` and `getRemoteApiClient()`.

- [ ] **Step 4: Replace IPC model list/test/chat handlers.** Keep sender authorization and existing channel names; call `backendService.listModelOptions()`, `backendService.testModel()`, and `backendService.streamChat()` directly. Forward backend events to the existing `IPC_CHANNELS.chat.event` and progress channel DTOs.

- [ ] **Step 5: Update the `clear-chat` workspace command to call `backendService.resetConversation()` before forwarding the renderer command.** Preserve existing overlay/UI behavior.

- [ ] **Step 6: Add guarded Electron quit handling.** On the first `before-quit`, prevent default, unregister shortcuts and dispose ASR/backend resources, then call `app.quit()` once disposal completes; subsequent `before-quit` passes through. Dispose failures are logged only after sanitization.

- [ ] **Step 7: Update main-structure tests to assert no `RemoteApiClient`, no `DEFAULT_BACKEND_URL`, backend initialization, IPC façade calls, and quit disposal. Run focused tests.**

Run: `Set-Location desktop; npx vitest run --root .. --config desktop/vitest.config.ts ../tests/desktop/backend/main-lifecycle.test.ts; node --test ../tests/desktop/test_main_structure.mjs`

- [ ] **Step 8: Commit the IPC integration.**

```powershell
git add desktop/src/main/main.ts desktop/src/main/model-test-coordinator.ts desktop/src/shared/contracts.ts desktop/src/preload/index.ts desktop/src/preload/settings.ts tests/desktop/backend/main-lifecycle.test.ts tests/desktop/test_main_structure.mjs
git commit -m "feat: route Electron IPC through native backend"
```

## Task 8: Remove the Python and local HTTP implementation after parity is green

**Files:**
- Delete: all tracked files listed in the plan's `Deleted after migration verification` section
- Delete: `desktop/src/main/remote-api-client.ts`
- Modify: `tests/desktop/test_remote_api_client.mjs` into provider/backend tests or delete it once equivalent focused coverage is present
- Modify: `tests/server/*` by deleting Python-only suites after the TypeScript suites cover the same behavior
- Modify: `README.md`
- Modify: `desktop/README.md`

- [ ] **Step 1: Run the complete new backend suite and the existing desktop suite before deletion.**

Run: `Set-Location desktop; npm run unit-test; npm run build; node --test ../tests/desktop/*.mjs`

Expected: all new direct-backend tests and all unaffected desktop tests pass before removing the old implementation.

- [ ] **Step 2: Delete only the tracked Python backend and local HTTP client files listed above.** Do not remove `cache/`, downloaded ASR model directories, release directories, `node_modules/`, `static/`, or the user-listed untracked tests.

- [ ] **Step 3: Update root and desktop README sections.** Replace Python setup/start commands with the statement that the EXE initializes the TypeScript backend in the Electron main process; keep provider configuration, local ASR, privacy, and model download instructions accurate.

- [ ] **Step 4: Update layout tests.** Assert `desktop/src/backend/` exists, its source contains no Python launch hooks, the Electron main source has no localhost backend URL, and documentation no longer instructs users to run Python.

- [ ] **Step 5: Run the focused layout and documentation tests, then commit the removal.**

```powershell
node --test tests/desktop/test_project_layout.mjs tests/desktop/test_main_structure.mjs
git add -u README.md desktop/README.md desktop/src/main/remote-api-client.ts server requirements-dev.txt start.bat tests/server tests/desktop/test_remote_api_client.mjs tests/desktop/test_project_layout.mjs
git commit -m "refactor: remove Python backend runtime"
```

## Task 9: Update package and artifact guards

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/package-lock.json` only if dependency metadata changes
- Modify: `tests/desktop/test_packaging_config.mjs`
- Modify: `tests/desktop/audit_packaged_artifact.mjs`
- Modify: `tests/desktop/test_project_layout.mjs`

- [ ] **Step 1: Write failing packaging tests.** Assert the build includes `dist/backend/**/*` through the existing `dist/**/*` rule, has no `extraResources` or `extraFiles` Python hook, and the source tree contains the backend TypeScript modules.

- [ ] **Step 2: Run the packaging tests and verify they fail against the old “no local backend” assertions.**

Run: `Set-Location desktop; node --test ../tests/desktop/test_packaging_config.mjs ../tests/desktop/test_project_layout.mjs`

- [ ] **Step 3: Update the assertions to the new boundary.** Keep all existing native ASR unpack rules, icon, target, installer, and no-model-weight checks; remove assertions that prohibit an Electron backend module.

- [ ] **Step 4: Run the packaging/layout suite and commit.**

```powershell
Set-Location desktop
node --test ../tests/desktop/test_packaging_config.mjs ../tests/desktop/test_project_layout.mjs
git add package.json ../tests/desktop/test_packaging_config.mjs ../tests/desktop/audit_packaged_artifact.mjs ../tests/desktop/test_project_layout.mjs
git commit -m "test: update packaging guards for native backend"
```

## Task 10: Full verification and Windows package audit

**Files:**
- No new production files; only fix files identified by failing verification commands.

- [ ] **Step 1: Run TypeScript checks.**

```powershell
Set-Location desktop
npm run typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Run the complete unit and desktop test suites.**

```powershell
npm run unit-test
npm run desktop-test
```

Expected: all tests pass; only the documented environment-related skips remain.

- [ ] **Step 3: Build the production Electron runtime.**

```powershell
npm run build
```

Expected: `desktop/dist/backend/` contains compiled backend JavaScript and Electron main compilation succeeds.

- [ ] **Step 4: Build unsigned Windows installer and portable artifacts.**

```powershell
npm run dist:win:unsigned
```

Expected: both NSIS and portable artifacts are produced under `desktop/release/`.

- [ ] **Step 5: Run package audits against both artifacts.**

```powershell
npm run audit:package
```

Expected: each ASAR audit passes, no Python or model entries are present, and the backend JavaScript is present under `dist/`.

- [ ] **Step 6: Perform a Windows smoke check.** Launch the newly built EXE without activating `.venv` or `start.bat`; verify the overlay opens, a configured model streams a response, Assist model verification works, `Ctrl+R` removes the conversation context, and closing the EXE leaves no Meeting-Monster child process or listener on port 9000.

- [ ] **Step 7: Review the final diff and status without staging user files.**

```powershell
git diff --check
git status --short
git diff HEAD --stat
```

Expected: only intentional migration files are tracked; existing `node_modules/`, `static/`, release directories, and user-listed untracked tests remain untracked.

- [ ] **Step 8: Commit verification fixes only if required, then report the exact test/build output.**

## Spec Coverage Self-Review

- Startup without Python or a manual service is covered by Tasks 6, 7, 8, and 10.
- Direct OpenAI/Anthropic streaming and image serialization are covered by Tasks 2–4.
- Conversation history, reset, cancellation, and disposal are covered by Tasks 4, 6, and 7.
- Vision challenge generation and strict verification are covered by Task 5.
- Encryption, IPC authorization, and redaction are covered by Tasks 1, 2, 6, and 7.
- Packaging and artifact exclusion are covered by Tasks 8–10.
- ASR boundaries and model-weight exclusion are preserved by the global constraints and Task 9.
- Python source and launch instructions are removed only after parity tests are green in Task 8.

## Plan Self-Review

- Self-review confirms every implementation step is concrete.
- Type consistency: `BackendModelSelection`, `BackendImage`, `BackendProvider`, `BackendChatEvent`, `BackendService`, `ProviderCache`, and `ConversationStore` are defined before consumers reference them.
- Each migration component has a failing-test step, focused command, minimal implementation step, green verification step, and scoped commit.
- The plan never stages the existing untracked build outputs, `node_modules/`, `static/`, or user-listed test files.
