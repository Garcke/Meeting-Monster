# Capsule Chat Symbol and Shared Opacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the capsule's closed/expanded action layout with a decorative `ฅ` Chat symbol and synchronize the expanded panel shell with the capsule's translucent surface.

**Architecture:** Keep the existing React state and `toggle-workspace` IPC intent. Render a fixed-width decorative icon slot in the capsule action for both states, use a fixed 70px action button, and move the shared visual values into the existing capsule and panel CSS rules without changing native window bounds or inner panel layers.

**Tech Stack:** React 18, TypeScript, Vite, Electron renderer CSS, Vitest, Node test runner, electron-builder.

## Global Constraints

- The closed action must read `ฅ Chat`; `ฅ` is decorative with `aria-hidden="true"`.
- The expanded action must retain the existing SVG chevron and read `Hide`; the chevron remains `aria-hidden="true"`.
- Both action states must use the same fixed button width and height: `70px × 30px`.
- The expanded panel shell must use `background: rgba(29, 36, 48, 0.68)` and `border: 1px solid rgba(255, 255, 255, 0.17)`.
- Keep `toggle-workspace`, `aria-expanded`, native overlay bounds, drag/no-drag regions, inner composer/menu surfaces, privacy behavior, settings page, dependencies, and version unchanged.
- Preserve the existing SVG chevron contract: `viewBox="0 0 14 14"`, path `M3.5 5.25 7 8.75l3.5-3.5`, no fill, `currentColor` stroke, `1.5` stroke width, round caps and joins.

---

### Task 1: Add the decorative Chat symbol and shared translucent panel surface

**Files:**
- Modify: `desktop/ui/capsule/CapsuleApp.tsx` (closed/expanded action markup)
- Modify: `desktop/ui/capsule/capsule.css` (fixed action geometry and symbol slot)
- Modify: `desktop/ui/panel/panel.css` (`.panel-shell` surface and border)
- Test: `tests/desktop/react_overlay.test.tsx` (React behavior and accessible names)
- Test: `tests/desktop/test_floating_capsule.mjs` (capsule source/CSS contracts)
- Test: `tests/desktop/test_frontend_structure.mjs` (panel surface and static markup contracts)

**Interfaces:**
- Consumes: the current `snapshot.target === 'workspace'` conditional and `toggle-workspace` intent in `CapsuleApp`.
- Produces: a closed button whose accessible name remains `Chat`, an expanded button whose accessible name remains `Hide`, and CSS contracts consumed by the existing overlay renderer.

- [ ] **Step 1: Write the failing React assertions**

  Extend the existing capsule tests so the closed state requires a `.capsule-chat-symbol` element with text `ฅ` and `aria-hidden="true"`, while the `Chat` accessible name remains available. After clicking, require the existing `.capsule-chevron` and `Hide` accessible name; after closing, require the symbol to return and the chevron to disappear.

- [ ] **Step 2: Run the focused React test to verify it fails**

  Run: `npm --prefix desktop run unit-test -- --run tests/desktop/react_overlay.test.tsx`

  Expected: FAIL because the current closed branch renders only the `Chat` string and has no `.capsule-chat-symbol` contract.

- [ ] **Step 3: Write the failing static contracts**

  Add assertions that the capsule source contains:

  ```tsx
  <span className="capsule-chat-symbol" aria-hidden="true">ฅ</span>
  ```

  and that the CSS contains a `14px × 14px` symbol slot, `width: 70px`, `min-width: 70px`, and the existing chevron contract. Add a panel CSS assertion that `.panel-shell` contains the exact shared background and border values.

- [ ] **Step 4: Run the focused static tests to verify they fail**

  Run: `node --test tests/desktop/test_floating_capsule.mjs tests/desktop/test_frontend_structure.mjs`

  Expected: FAIL because production CSS still has an auto-width action and `.panel-shell` still uses `rgba(17, 22, 31, 0.9)`.

- [ ] **Step 5: Implement the minimal React markup**

  Change only the closed branch of the existing action button to render the decorative symbol and label:

  ```tsx
  <>
      <span className="capsule-chat-symbol" aria-hidden="true">ฅ</span>
      <span>Chat</span>
  </>
  ```

  Keep the expanded SVG chevron and `<span>Hide</span>` unchanged, including `aria-hidden="true"` and the existing path.

- [ ] **Step 6: Implement fixed capsule geometry and synchronized panel surface**

  In `capsule.css`, set `.capsule-button` to `width: 70px`, `min-width: 70px`, retain `height: 30px`, and keep centered inline-flex layout. Add:

  ```css
  .capsule-chat-symbol {
      display: inline-flex;
      width: 14px;
      height: 14px;
      flex: 0 0 14px;
      align-items: center;
      justify-content: center;
      font-family: "Segoe UI Symbol", "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1;
  }
  ```

  Keep a `7px` gap for the expanded chevron button and apply the same gap to the shared button layout. In `panel.css`, replace only `.panel-shell`'s surface values with `rgba(29, 36, 48, 0.68)` and `1px solid rgba(255, 255, 255, 0.17)`; keep inner composer/menu backgrounds unchanged.

- [ ] **Step 7: Run focused tests and inspect the diff**

  Run:

  ```text
  npm --prefix desktop run unit-test -- --run tests/desktop/react_overlay.test.tsx
  node --test tests/desktop/test_floating_capsule.mjs tests/desktop/test_frontend_structure.mjs
  git diff --check
  ```

  Expected: all focused tests pass, the accessible names remain `Chat`/`Hide`, and the diff contains only the listed capsule/panel files and tests.

- [ ] **Step 8: Commit the implementation**

  ```bash
  git add desktop/ui/capsule/CapsuleApp.tsx desktop/ui/capsule/capsule.css desktop/ui/panel/panel.css tests/desktop/react_overlay.test.tsx tests/desktop/test_floating_capsule.mjs tests/desktop/test_frontend_structure.mjs
  git commit -m "fix: stabilize capsule chat control surface"
  ```

After this task, run the full verification suite and unsigned Windows packaging: `npm --prefix desktop run unit-test`, `npm --prefix desktop run typecheck`, `npm --prefix desktop run build`, `npm --prefix desktop run desktop-test`, and `npm --prefix desktop run dist:win:unsigned`.
