# Meeting-Monster Overlay Controls and Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move transcription and clear controls from the Chat composer into the `•••` menu, add the approved keyboard behavior, enrich capsule status feedback, and replace the square exit glyph with a red `×` without changing Meeting-Monster's manual-recording model.

**Architecture:** Keep `PcmAudioRecorder` ownership in `WorkspaceView`, because the renderer owns the live media tracks. Add a typed workspace-command IPC bridge so menu actions and main-process keyboard handlers reach the same renderer functions; keep local web-shortcut classification and global overlay movement in the main process. Extend the existing single-window overlay controller for bounded keyboard movement, and derive menu/capsule state from the existing `AsrStatus` state machine.

**Tech Stack:** Electron 37, React 19, TypeScript 5.9, Vite 8, Vitest 4, Testing Library, Node test runner, CSS.

## Global Constraints

- Opening the capsule or Chat must never start microphone or system-audio capture automatically.
- `Ctrl+S` toggles transcription only while the overlay BrowserWindow is focused; it does nothing in Settings.
- `Ctrl+R` clears Chat only while the expanded Chat panel is focused and never reloads a Meeting-Monster page.
- `Ctrl+\`, `Ctrl+方向键`, and `Ctrl+Shift+↑/↓` are global; failed Electron registrations are logged without aborting startup.
- Clear Chat cancels an active AI request and clears visible conversation state, but never calls `stopRecording()` or `api.asr.stop()`.
- The menu contains no Ask action and no Stop session action.
- The composer retains Assist, 追问, 重述, segment count, send hint, and send button, but contains no 开始转写, 停止, or 清空 controls.
- Preserve text editing (`Ctrl+C/V/X/A/Z/Y`), screenshot protection, and complete-application quit behavior.
- Do not add dependencies, change version `2.2.5`, build installers, or stage `desktop/release-*` and root `node_modules/`.
- Preserve unrelated user changes; stage only the exact files named by each task.

## File Structure

**Create**

- `desktop/src/main/web-shortcut-policy.ts` — pure local shortcut classifier.
- `desktop/ui/shared/services/transcription-status-store.ts` — renderer-wide ASR status source shared by Chat, menu, and capsule.
- `tests/desktop/web-shortcut-policy.test.ts` — shortcut scope/editing-key tests.

**Modify**

- `desktop/src/shared/contracts.ts` — command type, channels, API.
- `desktop/src/preload/index.ts` — overlay command bridge.
- `desktop/src/main/main.ts` — authorization, key interception, global shortcuts.
- `desktop/src/main/overlay-window-controller.ts` — bounded keyboard movement.
- `desktop/ui/panel/WorkspaceView.tsx` — shared commands, independent clear, scrolling, composer.
- `desktop/ui/panel/WorkspaceMenu.tsx` and `panel.css` — compact menu and switches.
- `desktop/ui/capsule/CapsuleApp.tsx` and `capsule.css` — red exit and five states.
- `desktop/package.json` and relevant files in `tests/desktop/` — automated coverage.

## Locked Interfaces

```ts
export type WorkspaceCommand =
    | {type: 'toggle-transcription'}
    | {type: 'clear-chat'}
    | {type: 'scroll-chat'; direction: 'up' | 'down'};

export interface MeetingMonsterApi {
    workspaceCommands: {
        dispatch(command: WorkspaceCommand): Promise<void>;
        onCommand(callback: (command: WorkspaceCommand) => void): Unsubscribe;
    };
}

export interface OverlayWindowController {
    moveBy(delta: {x: number; y: number}, workArea: WindowBounds): WindowBounds | null;
}

export function publishTranscriptionStatus(status: AsrStatus): void;
export function useTranscriptionStatus(): AsrStatus;
```

Every later task uses these names and signatures exactly.

---

### Task 0: Preserve Existing Approved Fixes as a Clean Baseline

**Files:**

- Existing modified: `desktop/ui/panel/panel.css`
- Existing modified: `desktop/ui/shared/services/asr-model-service.ts`
- Existing modified: `tests/desktop/react_overlay.test.tsx`
- Existing modified: `tests/desktop/react_services.test.ts`

**Interfaces:**

- Consumes: existing approved cursor and unsupported-hotword-copy changes.
- Produces: a clean tracked baseline before this plan overlaps CSS/tests.

- [ ] **Step 1: Review only the four tracked diffs**

```powershell
git diff -- desktop/ui/panel/panel.css desktop/ui/shared/services/asr-model-service.ts tests/desktop/react_overlay.test.tsx tests/desktop/react_services.test.ts
```

Expected: only the previously approved changes and regression tests.

- [ ] **Step 2: Re-run baseline verification**

```powershell
npm --prefix desktop run unit-test
npm --prefix desktop run typecheck
npm --prefix desktop run desktop-test
```

Expected: 81 Vitest tests pass; typecheck passes; Node desktop suite has no failures and may retain its Windows symlink skip.

- [ ] **Step 3: Stage exactly four files and inspect the index**

```powershell
git add -- desktop/ui/panel/panel.css desktop/ui/shared/services/asr-model-service.ts tests/desktop/react_overlay.test.tsx tests/desktop/react_services.test.ts
git diff --cached --name-only
```

Expected: exactly the four paths above; no release or dependency directory.

- [ ] **Step 4: Commit the preserved baseline**

```powershell
git commit -m "fix: simplify ASR metadata and panel cursor"
```

---

### Task 1: Add the Typed Workspace-Command Bridge

**Files:**

- Modify: `desktop/src/shared/contracts.ts:3-47,201-265`
- Modify: `desktop/src/preload/index.ts:1-136`
- Modify: `desktop/src/main/main.ts:600-687,667-982`
- Test: `tests/desktop/test_preload_contract.mjs`
- Test: `tests/desktop/test_main_structure.mjs`

**Interfaces:**

- Consumes: `IPC_CHANNELS`, `MeetingMonsterApi`, `isOverlayWebContents()`.
- Produces: `WorkspaceCommand`, `IPC_CHANNELS.workspaceCommands`, renderer bridge, `requireWorkspaceCommand()`, `sendWorkspaceCommand()`.

- [ ] **Step 1: Write failing source-contract tests**

```js
assert.match(contracts, /export type WorkspaceCommand\s*=\s*[\s\S]*toggle-transcription[\s\S]*clear-chat[\s\S]*scroll-chat/);
assert.match(preload, /workspaceCommands:\s*\{[\s\S]*dispatch:[\s\S]*onCommand:/);
assert.match(main, /ipcMain\.handle\(IPC_CHANNELS\.workspaceCommands\.dispatch,[\s\S]*isOverlayWebContents\(event\.sender\)/);
assert.match(main, /function requireWorkspaceCommand\(/);
assert.match(main, /function sendWorkspaceCommand\(/);
```

Add `workspaceCommands.dispatch` to the overlay-only authorization list.

- [ ] **Step 2: Verify RED**

```powershell
node --test tests/desktop/test_preload_contract.mjs tests/desktop/test_main_structure.mjs
```

Expected: FAIL because the contract and bridge do not exist.

- [ ] **Step 3: Add shared channels and types**

```ts
workspaceCommands: {
    dispatch: 'workspace-commands:dispatch',
    event: 'workspace-commands:event',
},

export type WorkspaceCommand =
    | {type: 'toggle-transcription'}
    | {type: 'clear-chat'}
    | {type: 'scroll-chat'; direction: 'up' | 'down'};
```

Add the exact `MeetingMonsterApi.workspaceCommands` interface from “Locked Interfaces”.

- [ ] **Step 4: Expose the safe overlay preload API**

```ts
workspaceCommands: {
    dispatch: (command) => ipcRenderer.invoke(
        IPC_CHANNELS.workspaceCommands.dispatch,
        command,
    ) as Promise<void>,
    onCommand: (callback: (command: WorkspaceCommand) => void) => subscribe(
        IPC_CHANNELS.workspaceCommands.event,
        callback,
    ),
},
```

Do not expose this namespace from `desktop/src/preload/settings.ts`.

- [ ] **Step 5: Validate and deliver commands in main**

```ts
function requireWorkspaceCommand(value: unknown): WorkspaceCommand {
    if (!value || typeof value !== 'object' || !('type' in value)) {
        throw new TypeError('Invalid workspace command');
    }
    const candidate = value as {type?: unknown; direction?: unknown};
    if (candidate.type === 'toggle-transcription' || candidate.type === 'clear-chat') {
        return {type: candidate.type};
    }
    if (candidate.type === 'scroll-chat'
        && (candidate.direction === 'up' || candidate.direction === 'down')) {
        return {type: 'scroll-chat', direction: candidate.direction};
    }
    throw new TypeError('Invalid workspace command');
}

function sendWorkspaceCommand(command: WorkspaceCommand): void {
    const overlay = getLiveOverlayWindows()[0];
    if (!overlay) return;
    overlay.webContents.send(IPC_CHANNELS.workspaceCommands.event, command);
}
```

Register `workspaceCommands.dispatch` as overlay-only and deliver the sanitized command.

- [ ] **Step 6: Verify GREEN and types**

```powershell
node --test tests/desktop/test_preload_contract.mjs tests/desktop/test_main_structure.mjs
npm --prefix desktop run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add -- desktop/src/shared/contracts.ts desktop/src/preload/index.ts desktop/src/main/main.ts tests/desktop/test_preload_contract.mjs tests/desktop/test_main_structure.mjs
git commit -m "feat: add typed workspace command bridge"
```

---

### Task 2: Route Recording, Clear, and Scroll Through One Renderer Handler

**Files:**

- Create: `desktop/ui/shared/services/transcription-status-store.ts`
- Modify: `desktop/ui/panel/WorkspaceView.tsx:1-227,329-365`
- Modify: `tests/desktop/react_overlay.test.tsx:10-115,219-227,461-479,657-840`
- Modify: `tests/desktop/react_services.test.ts`

**Interfaces:**

- Consumes: `workspaceCommands.onCommand()` and existing recording/chat functions.
- Produces: renderer-wide transcription status, command-driven toggle, `clearChat()` without recording side effects, and `scrollChat(direction)`.

- [ ] **Step 1: Extend `fakeApi()` with command listeners**

```ts
const workspaceCommandListeners = new Set<(command: WorkspaceCommand) => void>();

workspaceCommands: {
    dispatch: vi.fn(async (command: WorkspaceCommand) => {
        for (const listener of workspaceCommandListeners) listener(command);
    }),
    onCommand: vi.fn((listener: (command: WorkspaceCommand) => void) => {
        workspaceCommandListeners.add(listener);
        return () => workspaceCommandListeners.delete(listener);
    }),
},
```

Return `emitWorkspaceCommand(command)` from the fake.

- [ ] **Step 2: Write failing renderer behavior tests**

Drive start and stop without composer buttons:

```ts
act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
await waitFor(() => expect(api.asr.start).toHaveBeenCalledWith(16000));
act(() => emitWorkspaceCommand({type: 'toggle-transcription'}));
await waitFor(() => expect(api.asr.stop).toHaveBeenCalledOnce());
```

For independent clear, start recording, add a final ASR result, begin an AI request, emit `{type: 'clear-chat'}`, then assert:

```ts
expect(container.querySelector('.question-row')).toBeNull();
expect(api.chat.cancel).toHaveBeenCalledOnce();
expect(api.asr.stop).not.toHaveBeenCalled();
```

For scroll, spy on `.answer-scroll.scrollBy`, emit up/down, and assert opposite signed `top` values.

In `react_services.test.ts`, import the planned status store, subscribe, publish `connecting` then `error`, verify immutable snapshots/notifications, unsubscribe, and verify no later notification.

- [ ] **Step 3: Verify RED**

```powershell
npm --prefix desktop run unit-test -- --run tests/desktop/react_overlay.test.tsx
```

Expected: FAIL because `WorkspaceView` has no command subscription and clear still stops recording.

- [ ] **Step 4: Add the renderer-wide transcription status store**

Implement an external store using `useSyncExternalStore`:

```ts
import {useSyncExternalStore} from 'react';
import type {AsrStatus} from '../../../src/shared/contracts';

let currentStatus: AsrStatus = {state: 'idle'};
const listeners = new Set<() => void>();

export function publishTranscriptionStatus(status: AsrStatus): void {
    currentStatus = {...status};
    for (const listener of listeners) listener();
}

export function subscribeTranscriptionStatus(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getTranscriptionStatus(): AsrStatus {
    return currentStatus;
}

export function useTranscriptionStatus(): AsrStatus {
    return useSyncExternalStore(
        subscribeTranscriptionStatus,
        getTranscriptionStatus,
        getTranscriptionStatus,
    );
}
```

- [ ] **Step 5: Publish every Workspace ASR transition**

Replace local-only `setAsr` calls with `publishTranscriptionStatus`, including main ASR callbacks, result errors, connecting, stopping, idle, capture permission errors, and input-ended errors. This is required so renderer-originated failures reach the menu and capsule, not only Chat.

- [ ] **Step 6: Subscribe through a current-handler ref**

```ts
const answerScrollRef = useRef<HTMLDivElement>(null);
const workspaceCommandHandlerRef = useRef<(command: WorkspaceCommand) => void>(() => undefined);

useEffect(() => api.workspaceCommands.onCommand((command) => {
    workspaceCommandHandlerRef.current(command);
}), [api]);
```

After action functions are defined, update the ref on every render so commands never capture stale platform/mode/phase state:

```ts
workspaceCommandHandlerRef.current = (command) => {
    if (command.type === 'toggle-transcription') {
        if (recordingPhaseRef.current === 'idle') void startRecording();
        else if (recordingPhaseRef.current === 'recording') void stopRecording();
        return;
    }
    if (command.type === 'clear-chat') {
        clearChat();
        return;
    }
    scrollChat(command.direction);
};
```

- [ ] **Step 7: Separate clear from stop and implement scrolling**

```ts
function clearChat() {
    cancelActiveRequest();
    storeRef.current.clear();
    setPartial('');
    setAnswer('');
    refresh();
}

function scrollChat(direction: 'up' | 'down') {
    const target = answerScrollRef.current;
    if (!target) return;
    const distance = Math.max(120, Math.round(target.clientHeight * 0.6));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    target.scrollBy({
        top: direction === 'up' ? -distance : distance,
        behavior: reduced ? 'auto' : 'smooth',
    });
}
```

Attach `ref={answerScrollRef}` to `.answer-scroll`. Keep the composer controls until Task 3.

- [ ] **Step 8: Migrate all existing recorder tests to command events**

Replace every `workspaceRecordButtons()` click with `emitWorkspaceCommand({type: 'toggle-transcription'})`. Preserve assertions for permission mapping, audio source changes, input-ended cleanup, delayed rejection, and stale-session protection.

- [ ] **Step 9: Verify renderer suite and types**

```powershell
npm --prefix desktop run unit-test
npm --prefix desktop run typecheck
```

- [ ] **Step 10: Commit**

```powershell
git add -- desktop/ui/shared/services/transcription-status-store.ts desktop/ui/panel/WorkspaceView.tsx tests/desktop/react_overlay.test.tsx tests/desktop/react_services.test.ts
git commit -m "feat: unify workspace recording commands"
```

---

### Task 3: Build the Compact `•••` Menu and Simplify the Composer

**Files:**

- Modify: `desktop/ui/panel/WorkspaceMenu.tsx:1-79`
- Modify: `desktop/ui/panel/WorkspaceView.tsx:349-365`
- Modify: `desktop/ui/panel/panel.css:34-48,84-101`
- Modify: `tests/desktop/react_overlay.test.tsx:28-115,267-323,461-479`
- Modify: `tests/desktop/test_floating_capsule.mjs:78-102`

**Interfaces:**

- Consumes: command dispatch, `useTranscriptionStatus()`, model status, privacy API, and window hide API.
- Produces: compact menu groups, transcription/screenshot switches, clear action, shortcut reference rows, and AI-only composer actions.

- [ ] **Step 1: Write failing menu/composer tests**

After opening `更多`, assert:

```ts
expect(screen.getByText('显示/隐藏窗口')).toBeTruthy();
expect(screen.getByText('移动悬浮窗')).toBeTruthy();
expect(screen.getByText('滚动聊天')).toBeTruthy();
expect(screen.getByRole('menuitemcheckbox', {name: /实时转写/})).toBeTruthy();
expect(screen.getByRole('menuitem', {name: /清空聊天/})).toBeTruthy();
expect(screen.getByRole('menuitemcheckbox', {name: /截图保护/})).toBeTruthy();
expect(screen.queryByText(/Ask/)).toBeNull();
expect(screen.queryByText(/Stop session/)).toBeNull();
```

Click transcription/clear and assert dispatch of `{type: 'toggle-transcription'}` / `{type: 'clear-chat'}`. Emit `recording`, `connecting`, `stopping` and assert `aria-checked` plus disabled transitions. Assert the composer has three `.composer-ai-action` buttons and no recorder/clear text.

- [ ] **Step 2: Verify RED**

```powershell
npm --prefix desktop run unit-test -- --run tests/desktop/react_overlay.test.tsx
node --test tests/desktop/test_floating_capsule.mjs
```

- [ ] **Step 3: Derive switch state from real ASR/model state**

```ts
const asr = useTranscriptionStatus();
const [asrReady, setAsrReady] = useState(false);
const recording = asr.state === 'recording';
const pending = asr.state === 'connecting' || asr.state === 'stopping';
const transcriptionDisabled = !asrReady || pending;
```

Use `isAsrModelReady()` for initial and changed model snapshots. Do not create a second menu-only ASR status subscription; the shared store is the single renderer presentation source.

- [ ] **Step 4: Add actions and final menu semantics**

```ts
const toggleTranscription = () => window.meetingMonster.workspaceCommands.dispatch({
    type: 'toggle-transcription',
});
const clearChat = () => window.meetingMonster.workspaceCommands.dispatch({type: 'clear-chat'});
```

“显示/隐藏窗口” calls `window.meetingMonster.window.hide()`; global `Ctrl+\` restores it. Movement/scroll rows are non-clickable shortcut references. Transcription renders:

```tsx
<button
    className="workspace-menu-item"
    type="button"
    role="menuitemcheckbox"
    aria-checked={recording}
    disabled={transcriptionDisabled}
    onClick={() => void toggleTranscription()}
>
    <span className="workspace-menu-item-label">实时转写</span>
    <kbd>Ctrl+S</kbd>
    <span className={`workspace-menu-switch ${recording ? 'is-on' : ''}`} aria-hidden="true" />
</button>
```

Rename “共享隐藏” to “截图保护”, retain the warning dot and platform behavior, and render the same switch visual.

- [ ] **Step 5: Remove composer controls and obsolete CSS**

Delete three `.record-action` buttons, their `.composer-divider`, and obsolete `.record-action` rules. Set popover width to `272px`; add compact section labels, separators, right-aligned `kbd`, 30-by-17-pixel switches, and visible focus. Keep every menu control `no-drag`.

- [ ] **Step 6: Verify GREEN and types**

```powershell
npm --prefix desktop run unit-test
node --test tests/desktop/test_floating_capsule.mjs
npm --prefix desktop run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add -- desktop/ui/panel/WorkspaceMenu.tsx desktop/ui/panel/WorkspaceView.tsx desktop/ui/panel/panel.css tests/desktop/react_overlay.test.tsx tests/desktop/test_floating_capsule.mjs
git commit -m "feat: move transcription controls into workspace menu"
```

---

### Task 4: Enforce Local `Ctrl+S` / `Ctrl+R` and Disable Web Shortcuts

**Files:**

- Create: `desktop/src/main/web-shortcut-policy.ts`
- Create: `tests/desktop/web-shortcut-policy.test.ts`
- Modify: `desktop/src/main/main.ts:988-1030`
- Modify: `desktop/package.json:8-18`
- Modify: `tests/desktop/test_main_structure.mjs:63-80`

**Interfaces:**

- Consumes: `sendWorkspaceCommand()` and current overlay snapshot.
- Produces: `classifyWebShortcut()` and `before-input-event` policies for overlay/settings.

- [ ] **Step 1: Write the failing policy matrix**

```ts
expect(classifyWebShortcut(ctrl('s'), 'overlay', false)).toBe('toggle-transcription');
expect(classifyWebShortcut(ctrl('s'), 'settings', false)).toBe('prevent');
expect(classifyWebShortcut(ctrl('r'), 'overlay', true)).toBe('clear-chat');
expect(classifyWebShortcut(ctrl('r'), 'overlay', false)).toBe('prevent');
expect(classifyWebShortcut(ctrl('r'), 'settings', false)).toBe('prevent');
```

Assert `prevent` for `F5`, `F11`, `F12`, `Ctrl+Shift+R`, `Ctrl+Shift+I`, `Ctrl+U`, `Ctrl+P`, `Ctrl+F`, `Ctrl++`, `Ctrl+-`, `Ctrl+0`. Assert `allow` for `Ctrl+C/V/X/A/Z/Y`, `Alt+F4`, arrows, Backspace, Delete, Tab.

- [ ] **Step 2: Add the test to `unit-test` and verify RED**

Append `../tests/desktop/web-shortcut-policy.test.ts` to the explicit Vitest file list, then run:

```powershell
npm --prefix desktop run unit-test -- --run tests/desktop/web-shortcut-policy.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact pure classifier types**

```ts
export type WebShortcutSurface = 'overlay' | 'settings';
export type WebShortcutAction =
    | 'allow'
    | 'prevent'
    | 'toggle-transcription'
    | 'clear-chat';

export interface WebShortcutInput {
    type: string;
    key: string;
    control: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
}
```

Only classify `keyDown`; treat `control || meta` as CommandOrControl; normalize the key; give overlay `Ctrl+S/R` custom actions before the generic block list; never block the six editing combinations.

Use this decision order:

```ts
export function classifyWebShortcut(
    input: WebShortcutInput,
    surface: WebShortcutSurface,
    chatExpanded: boolean,
): WebShortcutAction {
    if (input.type !== 'keyDown') return 'allow';
    const key = input.key.toLowerCase();
    const command = input.control || input.meta;
    if (key === 'f5' || key === 'f11' || key === 'f12') return 'prevent';
    if (!command || input.alt) return 'allow';
    if (surface === 'overlay' && !input.shift && key === 's') {
        return 'toggle-transcription';
    }
    if (surface === 'overlay' && !input.shift && key === 'r') {
        return chatExpanded ? 'clear-chat' : 'prevent';
    }
    if (key === 's' || key === 'r' || key === 'u' || key === 'p'
        || key === 'f' || key === '+' || key === '-' || key === '0') {
        return 'prevent';
    }
    if (input.shift && key === 'i') return 'prevent';
    return 'allow';
}
```

- [ ] **Step 4: Install the policy on both BrowserWindows**

```ts
function configureWebShortcutPolicy(win: BrowserWindow, surface: WebShortcutSurface): void {
    win.webContents.on('before-input-event', (event, input) => {
        const action = classifyWebShortcut(
            input,
            surface,
            getOverlaySnapshot().target === 'workspace',
        );
        if (action === 'allow') return;
        event.preventDefault();
        if (action === 'toggle-transcription') {
            sendWorkspaceCommand({type: 'toggle-transcription'});
        } else if (action === 'clear-chat') {
            sendWorkspaceCommand({type: 'clear-chat'});
        }
    });
}
```

Call from `configureOverlayWindow(..., 'overlay')` and `configureSettingsWindow(..., 'settings')`. Do not register global `Ctrl+S/R`.

- [ ] **Step 5: Add main source assertions**

Assert both windows install the policy, custom actions call `preventDefault()` and send exact commands, and source lacks `globalShortcut.register('CommandOrControl+S'` / `...+R`.

- [ ] **Step 6: Verify GREEN, structure, and types**

```powershell
npm --prefix desktop run unit-test
node --test tests/desktop/test_main_structure.mjs
npm --prefix desktop run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add -- desktop/src/main/web-shortcut-policy.ts desktop/src/main/main.ts desktop/package.json tests/desktop/web-shortcut-policy.test.ts tests/desktop/test_main_structure.mjs
git commit -m "feat: enforce overlay web shortcut policy"
```

---

### Task 5: Add Bounded Movement and Approved Global Shortcuts

**Files:**

- Modify: `desktop/src/main/overlay-window-controller.ts:16-61,74-92,136-205`
- Modify: `desktop/src/main/main.ts:629-637,1085-1115`
- Modify: `tests/desktop/test_single_overlay_window_controller.mjs`
- Modify: `tests/desktop/test_main_structure.mjs:63-80`
- Modify: `tests/desktop/test_floating_capsule.mjs:184-190`

**Interfaces:**

- Consumes: scroll workspace command, Electron `screen.getDisplayMatching()`, overlay target/visibility.
- Produces: `moveBy(delta, workArea)` and `Ctrl+\`, movement, scrolling accelerators.

- [ ] **Step 1: Write failing movement tests**

Call:

```js
controller.moveBy({x: -24, y: 24}, {x: 0, y: 0, width: 1920, height: 1080});
```

Collapsed: visible capsule stays inside the work area while native bounds still use `expandedBounds(anchor)`. Expanded: repeated movement toward each edge keeps the full `648 × 512` overlay within the work area. `setBounds` retains existing width/height.

- [ ] **Step 2: Build and verify RED**

```powershell
npm --prefix desktop run build:main
node --test tests/desktop/test_single_overlay_window_controller.mjs
```

Expected: FAIL because `moveBy` is absent.

- [ ] **Step 3: Implement target-aware anchor clamping**

```ts
export function clampAnchorToWorkArea(
    anchor: {x: number; y: number},
    workArea: WindowBounds,
    expanded: boolean,
): {x: number; y: number} {
    const minX = expanded ? workArea.x - PANEL_OFFSET.x : workArea.x;
    const maxX = expanded
        ? workArea.x + workArea.width - OVERLAY_BOUNDS.width - PANEL_OFFSET.x
        : workArea.x + workArea.width - CAPSULE_BOUNDS.width;
    const minY = workArea.y;
    const maxY = workArea.y + workArea.height
        - (expanded ? OVERLAY_BOUNDS.height : CAPSULE_BOUNDS.height);
    return {
        x: Math.min(Math.max(anchor.x, minX), Math.max(minX, maxX)),
        y: Math.min(Math.max(anchor.y, minY), Math.max(minY, maxY)),
    };
}
```

`moveBy()` adds the delta to stored anchor, clamps using `snapshot.target === 'workspace'`, calls `setBounds(expandedBounds(anchor))`, and returns bounds; it returns `null` when unavailable.

- [ ] **Step 4: Add checked global registrations**

```ts
function registerGlobalShortcut(accelerator: string, callback: () => void): void {
    if (!globalShortcut.register(accelerator, callback)) {
        console.warn(`[desktop] global shortcut unavailable: ${accelerator}`);
    }
}
```

Keep `CommandOrControl+Shift+P`, replace `CommandOrControl+Shift+M` with `CommandOrControl+\`, and add:

```text
CommandOrControl+Up
CommandOrControl+Down
CommandOrControl+Left
CommandOrControl+Right
CommandOrControl+Shift+Up
CommandOrControl+Shift+Down
```

Movement step is `24` pixels. For an expanded target, pass the native overlay bounds to `screen.getDisplayMatching()`; for a collapsed target, pass `{x: native.x + CAPSULE_SHAPE.x, y: native.y + CAPSULE_SHAPE.y, ...CAPSULE_BOUNDS}` so a transparent off-shape region cannot select the wrong monitor. Scroll sends commands only when the overlay is visible and expanded; it never opens Chat.

- [ ] **Step 5: Update structural tests**

Assert all approved accelerators, absence of `CommandOrControl+Shift+M`, `moveBy` usage, scroll directions, failed-registration warning, and retained `unregisterAll()`.

- [ ] **Step 6: Verify GREEN, build, and types**

```powershell
npm --prefix desktop run build:main
node --test tests/desktop/test_single_overlay_window_controller.mjs tests/desktop/test_main_structure.mjs tests/desktop/test_floating_capsule.mjs
npm --prefix desktop run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add -- desktop/src/main/overlay-window-controller.ts desktop/src/main/main.ts tests/desktop/test_single_overlay_window_controller.mjs tests/desktop/test_main_structure.mjs tests/desktop/test_floating_capsule.mjs
git commit -m "feat: add bounded overlay keyboard controls"
```

---

### Task 6: Render the Red Exit `×` and Five Capsule States

**Files:**

- Modify: `desktop/ui/capsule/CapsuleApp.tsx:32-67`
- Modify: `desktop/ui/capsule/capsule.css:40-84,104-144`
- Modify: `tests/desktop/react_overlay.test.tsx:233-338`
- Modify: `tests/desktop/test_floating_capsule.mjs:22-76`

**Interfaces:**

- Consumes: shared transcription status store, main ASR status events, and existing `window.quit()`.
- Produces: fixed-width Chinese status, state-specific indicators, reduced-motion safety, red `×`.

- [ ] **Step 1: Make fake ASR status observable and write failing tests**

Store `asr.onStatus()` listeners and return `emitAsrStatus(status)`. Drive all states and assert:

```ts
const expected = {
    idle: '就绪',
    connecting: '正在启动',
    recording: '正在转写',
    stopping: '正在停止',
    error: '转写异常',
};
```

For each state, `.capsule-state-indicator` has matching `data-state`. Assert exit accessible name `退出 Meeting-Monster` and visible glyph `×`.

Render `OverlayApp`, force a renderer-side microphone permission failure before `api.asr.start()`, trigger `{type: 'toggle-transcription'}`, and assert the capsule changes to `转写异常`. This guards the shared-store architecture rather than only main-process status events.

- [ ] **Step 2: Verify RED**

```powershell
npm --prefix desktop run unit-test -- --run tests/desktop/react_overlay.test.tsx
node --test tests/desktop/test_floating_capsule.mjs
```

- [ ] **Step 3: Map every ASR state**

```ts
const STATUS_LABELS: Record<AsrState, string> = {
    idle: '就绪',
    connecting: '正在启动',
    recording: '正在转写',
    stopping: '正在停止',
    error: '转写异常',
};
```

Read presentation state with `useTranscriptionStatus()`. In the existing capsule effect, route `api.asr.onStatus` and `api.asr.getStatus()` through `publishTranscriptionStatus()` so `CapsuleApp` also remains correct when rendered alone in tests. Render `.capsule-state-indicator` with `data-state={asr.state}`. Render three decorative bars only for `recording`; render `!` only for `error`; keep graphics `aria-hidden`.

- [ ] **Step 4: Lock status geometry and implement visual states**

Set `.capsule-status` to `width: 66px; flex: 0 0 66px`. Use:

- idle: green circle `#74e8a4`
- connecting: orange ring `#f3a35c`, restrained pulse
- recording: three pink/red bars `#ff7088`, staggered waveform
- stopping: orange circle, restrained fade
- error: red `!` `#ff626d`

Under `prefers-reduced-motion: reduce`, set all state animations to `none` while retaining color/shape.

- [ ] **Step 5: Replace glyph but keep quit logic**

```tsx
<button
    className="capsule-stop"
    type="button"
    aria-label="退出 Meeting-Monster"
    title="退出 Meeting-Monster"
    onClick={() => void window.meetingMonster.window.quit().catch(() => undefined)}
>
    <span aria-hidden="true">×</span>
</button>
```

Default is a red icon on translucent dark surface; hover adds subtle red border/background, not a solid bright-red circle.

- [ ] **Step 6: Verify GREEN and types**

```powershell
npm --prefix desktop run unit-test
node --test tests/desktop/test_floating_capsule.mjs
npm --prefix desktop run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add -- desktop/ui/capsule/CapsuleApp.tsx desktop/ui/capsule/capsule.css tests/desktop/react_overlay.test.tsx tests/desktop/test_floating_capsule.mjs
git commit -m "feat: enrich capsule transcription status"
```

---

### Task 7: Full Regression, Visual QA, and Final Review

**Files:**

- Verify: all files changed in Tasks 1-6.
- Do not create installer artifacts.

**Interfaces:**

- Consumes: every committed deliverable.
- Produces: evidence for branch integration or later publication.

- [ ] **Step 1: Check whitespace, status, and commit scope**

```powershell
git diff --check HEAD~6..HEAD
git status --short
git log --oneline -8
```

Expected: no whitespace errors; only known ignored/untracked release directories remain; feature history is reviewable.

- [ ] **Step 2: Run complete automated verification**

```powershell
npm --prefix desktop run unit-test
npm --prefix desktop run typecheck
npm --prefix desktop run desktop-test
```

Expected: Vitest/typecheck/main+renderer build pass; Node desktop tests have zero failures; existing platform-specific Windows symlink skip may remain.

- [ ] **Step 3: Perform exact manual overlay QA**

```powershell
npm --prefix desktop start
```

Verify, then close normally:

```text
[ ] Ctrl+S starts/stops only while capsule/Chat is focused and releases audio on stop.
[ ] Ctrl+S in Settings does not start transcription.
[ ] Ctrl+R clears expanded Chat without stopping transcription.
[ ] F5, Ctrl+Shift+R, F12, Ctrl+Shift+I, Ctrl+F, Ctrl+P, Ctrl+U and zoom do no web action.
[ ] Ctrl+C/V/X/A/Z/Y still work in Chat and Settings inputs.
[ ] Ctrl+\ hides/restores the overlay.
[ ] Ctrl+方向键 stays inside active display work area.
[ ] Ctrl+Shift+↑/↓ scrolls only the open answer area.
[ ] Menu switch, clear, screenshot protection, settings all work.
[ ] Composer has no transcription/clear controls.
[ ] Five capsule states remain readable without width changes.
[ ] Red × exits the whole application.
```

- [ ] **Step 4: Request two-stage review**

Use `superpowers:requesting-code-review` for spec compliance, then code quality. Resolve blocker/high-priority findings with focused tests and commits; repeat Step 2 afterward.

- [ ] **Step 5: Report readiness without publishing**

Report test counts, manual QA, commits, and existing untracked release directories. Do not push, open a PR, build an EXE, or publish until the user explicitly requests it.
