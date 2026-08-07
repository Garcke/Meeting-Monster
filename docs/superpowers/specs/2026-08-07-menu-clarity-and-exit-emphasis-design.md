# Menu Clarity and Exit Emphasis Design

Date: 2026-08-07

## Goal

Restore the explanatory copy for screenshot protection, make the existing `Ctrl+R` clear-chat shortcut discoverable, and make the capsule exit control immediately recognizable without changing its quit behavior or the dark translucent visual language.

## User-facing behavior

### Screenshot protection

The `•••` menu keeps the compact privacy row, but the row becomes a two-line information block:

- Primary line: `截图保护` with the existing switch and accessibility state.
- Supporting copy: `开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。`

The copy describes the best-effort capture-protection behavior in plain language. Toggling the switch, warning dot, status synchronization, and underlying Electron content-protection API remain unchanged.

### Clear chat shortcut

The `清空聊天` menu action gains a right-aligned `<kbd>Ctrl+R</kbd>` hint. The action remains available only through the existing workspace command path, and `Ctrl+R` continues to clear expanded Chat without stopping transcription or refreshing the page.

### Exit control

The far-right capsule control remains a complete application quit action. Its presentation changes to:

- 34px by 34px red filled circular button;
- large, bold white `×` glyph (approximately 18px);
- darker red hover treatment and a visible keyboard focus ring;
- existing accessible label/title and `window.meetingMonster.window.quit()` call preserved.

The capsule's fixed geometry and status width remain unchanged; the larger control must fit inside the current native capsule bounds without changing the expanded overlay layout.

## Scope and non-goals

- Do not change screenshot-protection semantics or its default state.
- Do not change any shortcut mapping; only expose the already implemented `Ctrl+R` text.
- Do not change the Chat clear command, recording lifecycle, or application quit behavior.
- Do not add dependencies, alter the app version, or change settings-page behavior.
- Do not stage existing untracked user files or release artifacts.

## Implementation boundaries

- `WorkspaceMenu.tsx` owns the restored copy and `Ctrl+R` hint.
- `panel.css` owns the two-line privacy row layout and compact typography.
- `capsule.css` owns the exit button dimensions, color, glyph scale, hover, and focus treatment.
- `CapsuleApp.tsx` changes only if the existing glyph markup needs an explicit presentational span; the quit handler remains untouched.
- Existing renderer/structure tests will assert exact copy, shortcut hint, and visual tokens while retaining the current behavior assertions.

## Verification

- Renderer tests assert the screenshot-protection explanation and `Ctrl+R` are rendered in the open menu.
- Structural capsule tests assert the 34px red exit control, readable glyph sizing, focus treatment, and preserved quit call.
- Run the renderer unit suite, TypeScript typecheck, desktop structural suite, and Windows unsigned packaging/audit after implementation.
