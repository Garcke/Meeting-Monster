# Meeting-Monster capsule and workspace menu polish

Date: 2026-08-07

## Goal

Refine the floating capsule and workspace menu so the exit control feels integrated, shortcut-only rows cannot be mistaken for clickable actions, privacy wording is clearer, and the panel header cannot expose selectable drag-hint text.

## Approved behavior

### Capsule exit control

Replace the solid-red 34 px exit button with the approved visual option A:

- 30 px circular control, matching the compact capsule scale.
- Dark translucent burgundy surface close to the earlier Meeting-Monster style.
- Thin, restrained red border and a clearer red `X`.
- Hover state strengthens the red surface and border without becoming a solid warning disc.
- Keyboard focus remains clearly visible.
- The existing `退出 Meeting-Monster` title, accessible label, and `window.meetingMonster.window.quit()` callback remain unchanged.

### Shortcut-only window controls

`显示/隐藏窗口` becomes a non-interactive reference row, matching `移动悬浮窗` and `滚动聊天`.

- It remains visible so users can discover `Ctrl+\`.
- It is not rendered as a button, cannot be clicked, and is not keyboard-focusable.
- The existing `Ctrl+\` shortcut implementation remains unchanged.
- `移动悬浮窗` and `滚动聊天` remain non-interactive reference rows.

A disabled button was rejected because it would look unavailable or broken. Removing the row was rejected because it would hide shortcut discoverability.

### Privacy label

Rename the user-facing `截图保护` menu label to `应用隐藏`.

- Keep the current toggle, state, pending behavior, warning dot, and privacy API unchanged.
- Keep the existing explanatory copy: `开启后，悬浮窗口不会出现在大多数屏幕共享和录屏画面中。`
- Do not claim that the behavior blocks every screenshot or capture method.

### Panel drag header

Remove the visible `拖动面板` text from the expanded Chat panel header.

- The header remains an Electron drag region.
- `TRANSCRIPT` and the `•••` menu stay in their current positions.
- Removing the text prevents accidental selection and visual noise without reducing the draggable area.

## Scope

Expected production files:

- `desktop/ui/capsule/capsule.css`
- `desktop/ui/panel/WorkspaceMenu.tsx`
- `desktop/ui/panel/PanelApp.tsx`
- `desktop/ui/panel/panel.css` only if obsolete drag-hint styling must be removed

Expected tests:

- `tests/desktop/react_overlay.test.tsx`
- `tests/desktop/test_floating_capsule.mjs`
- other existing focused structural tests only when required by current assertions

Do not change shortcut registration, privacy IPC, overlay geometry, recording controls, clear-chat behavior, settings navigation, application version, or packaging configuration.

## Validation

- Renderer tests verify `显示/隐藏窗口` is present as reference text but has no menu-item/button role.
- Renderer tests verify `应用隐藏` remains an interactive checkbox item with its explanatory copy and existing privacy behavior.
- Structural tests verify the approved 30 px exit-control tokens, hover/focus states, and preserved quit callback/accessibility.
- Structural or renderer tests verify `拖动面板` is absent while the header drag region remains.
- Run unit tests, TypeScript type checking, production build, tracked desktop Node tests, and package audit before completion.

## Visual acceptance criteria

The exit control must read as a deliberate but secondary destructive action: clearly identifiable at a glance, visually aligned with the translucent capsule, and less dominant than the `Chat`/`Hide` control.
