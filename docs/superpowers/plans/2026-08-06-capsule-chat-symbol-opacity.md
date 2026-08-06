# Capsule Chat Symbol and Shared Opacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the capsule's closed/expanded action layout with the supplied paw SVG before Chat and synchronize the expanded panel shell with the capsule's translucent surface.

**Architecture:** Keep the existing React state and `toggle-workspace` IPC intent. Render a fixed-width decorative icon slot in the capsule action for both states, use a fixed 70px action button, and move the shared visual values into the existing capsule and panel CSS rules without changing native window bounds or inner panel layers.

**Tech Stack:** React 18, TypeScript, Vite, Electron renderer CSS, Vitest, Node test runner, electron-builder.

## Global Constraints

- The closed action must render the supplied `C:\Users\EDY\Downloads\爪子.svg` paw artwork before `Chat`; the inline SVG is decorative with `aria-hidden="true"` and `viewBox="0 0 1259 1024"`.
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

- [x] **Step 1: Write the failing React assertions**

  Extend the existing capsule tests so the closed state requires a `.capsule-chat-symbol` SVG with `viewBox="0 0 1259 1024"`, `aria-hidden="true"`, and a path from the supplied paw artwork, while the `Chat` accessible name remains available. After clicking, require the existing `.capsule-chevron` and `Hide` accessible name; after closing, require the paw SVG to return and the chevron to disappear.

- [x] **Step 2: Run the focused React test to verify it fails**

  Run: `npm --prefix desktop run unit-test -- --run tests/desktop/react_overlay.test.tsx`

  Expected: FAIL because the current closed branch renders only the `Chat` string and has no `.capsule-chat-symbol` contract.

- [x] **Step 3: Write the failing static contracts**

  Add assertions that the capsule source contains:

  ```tsx
  <svg className="capsule-chat-symbol" viewBox="0 0 1259 1024" aria-hidden="true">
      <path d="M635.211887 354.085959c-236.873121 0-430.651342 311.057206-430.651342 430.651342 0 236.906195 193.778221 239.254421 430.651342 239.254421 236.873121 0 430.618269-2.381299 430.618269-239.221347 0-119.62721-193.745147-430.684416-430.618269-430.684416z m0 574.256912c-184.219951 0-334.936345 0-334.936344-143.572496 0-71.769711 150.716394-334.969418 334.936344-334.969419s334.936345 263.199707 334.936345 334.936345c0 167.484709-150.716394 143.539423-334.936345 143.539423v0.066147zM139.934731 258.404035A139.702885 139.702885 0 0 0 0.000331 398.305362a139.702885 139.702885 0 0 0 139.9344 139.967474 139.702885 139.702885 0 0 0 140.000548-139.934401A139.702885 139.702885 0 0 0 139.901658 258.370961z m0 193.745147a53.314643 53.314643 0 0 1-53.810747-53.810747c0-30.196197 23.680697-53.84382 53.810747-53.84382 30.196197 0 53.876894 23.680697 53.876894 53.84382a53.347716 53.347716 0 0 1-53.876894 53.843821z m979.739245-172.247307a139.702885 139.702885 0 0 0-139.967474 139.967474 139.702885 139.702885 0 0 0 139.967474 139.9344 139.702885 139.702885 0 0 0 139.967474-139.9344 139.702885 139.702885 0 0 0-139.967474-139.967474z m0 193.811294a53.314643 53.314643 0 0 1-53.84382-53.84382c0-30.163123 23.713771-53.810747 53.84382-53.810747 30.163123 0 53.810747 23.680697 53.810747 53.810747a53.347716 53.347716 0 0 1-53.810747 53.810746zM861.236868 21.49784a139.702885 139.702885 0 0 0-139.934401 139.967474 139.702885 139.702885 0 0 0 139.934401 139.967474 139.702885 139.702885 0 0 0 140.000548-139.967474A139.702885 139.702885 0 0 0 861.236868 21.49784z m0 193.811294a53.314643 53.314643 0 0 1-53.810747-53.810746c0-30.196197 23.680697-53.84382 53.810747-53.843821 30.196197 0 53.84382 23.680697 53.84382 53.843821A53.347716 53.347716 0 0 1 861.236868 215.309134zM452.182586 0C363.876075 0 290.717272 73.158803 290.717272 161.498388c0 88.240364 73.191876 161.465314 161.498388 161.465313s161.498388-73.191876 161.498387-161.498387S540.456024 0 452.182586 0z m0 236.840048c-40.912043 0-75.34166-34.462691-75.34166-75.34166 0-40.945116 34.429617-75.407807 75.34166-75.407808 40.945116 0 75.34166 34.462691 75.341661 75.407808 0 40.912043-34.429617 75.34166-75.308587 75.34166z" />
  </svg>
  ```

  and that the CSS contains a `14px × 14px` symbol slot, `width: 70px`, `min-width: 70px`, and the existing chevron contract. Add a panel CSS assertion that `.panel-shell` contains the exact shared background and border values.

- [x] **Step 4: Run the focused static tests to verify they fail**

  Run: `node --test tests/desktop/test_floating_capsule.mjs tests/desktop/test_frontend_structure.mjs`

  Expected: FAIL because production CSS still has an auto-width action and `.panel-shell` still uses `rgba(17, 22, 31, 0.9)`.

- [x] **Step 5: Implement the minimal React markup**

  Change only the closed branch of the existing action button to render the supplied paw SVG artwork and label:

  ```tsx
  <>
      <svg className="capsule-chat-symbol" viewBox="0 0 1259 1024" aria-hidden="true">
          <path d="M635.211887 354.085959c-236.873121 0-430.651342 311.057206-430.651342 430.651342 0 236.906195 193.778221 239.254421 430.651342 239.254421 236.873121 0 430.618269-2.381299 430.618269-239.221347 0-119.62721-193.745147-430.684416-430.618269-430.684416z m0 574.256912c-184.219951 0-334.936345 0-334.936344-143.572496 0-71.769711 150.716394-334.969418 334.936344-334.969419s334.936345 263.199707 334.936345 334.936345c0 167.484709-150.716394 143.539423-334.936345 143.539423v0.066147zM139.934731 258.404035A139.702885 139.702885 0 0 0 0.000331 398.305362a139.702885 139.702885 0 0 0 139.9344 139.967474 139.702885 139.702885 0 0 0 140.000548-139.934401A139.702885 139.702885 0 0 0 139.901658 258.370961z m0 193.745147a53.314643 53.314643 0 0 1-53.810747-53.810747c0-30.196197 23.680697-53.84382 53.810747-53.84382 30.196197 0 53.876894 23.680697 53.876894 53.84382a53.347716 53.347716 0 0 1-53.876894 53.843821z m979.739245-172.247307a139.702885 139.702885 0 0 0-139.967474 139.967474 139.702885 139.702885 0 0 0 139.967474 139.9344 139.702885 139.702885 0 0 0 139.967474-139.9344 139.702885 139.702885 0 0 0-139.967474-139.967474z m0 193.811294a53.314643 53.314643 0 0 1-53.84382-53.84382c0-30.163123 23.713771-53.810747 53.84382-53.810747 30.163123 0 53.810747 23.680697 53.810747 53.810747a53.347716 53.347716 0 0 1-53.810747 53.810746zM861.236868 21.49784a139.702885 139.702885 0 0 0-139.934401 139.967474 139.702885 139.702885 0 0 0 139.934401 139.967474 139.702885 139.702885 0 0 0 140.000548-139.967474A139.702885 139.702885 0 0 0 861.236868 21.49784z m0 193.811294a53.314643 53.314643 0 0 1-53.810747-53.810746c0-30.196197 23.680697-53.84382 53.810747-53.843821 30.196197 0 53.84382 23.680697 53.84382 53.843821A53.347716 53.347716 0 0 1 861.236868 215.309134zM452.182586 0C363.876075 0 290.717272 73.158803 290.717272 161.498388c0 88.240364 73.191876 161.465314 161.498388 161.465313s161.498388-73.191876 161.498387-161.498387S540.456024 0 452.182586 0z m0 236.840048c-40.912043 0-75.34166-34.462691-75.34166-75.34166 0-40.945116 34.429617-75.407807 75.34166-75.407808 40.945116 0 75.34166 34.462691 75.341661 75.407808 0 40.912043-34.429617 75.34166-75.308587 75.34166z" />
      </svg>
      <span>Chat</span>
  </>
  ```

  Keep the expanded SVG chevron and `<span>Hide</span>` unchanged, including `aria-hidden="true"` and the existing path.

- [x] **Step 6: Implement fixed capsule geometry and synchronized panel surface**

  In `capsule.css`, set `.capsule-button` to `width: 70px`, `min-width: 70px`, retain `height: 30px`, and keep centered inline-flex layout. Add:

  ```css
  .capsule-chat-symbol {
      display: inline-flex;
      width: 14px;
      height: 14px;
      flex: 0 0 14px;
      align-items: center;
      justify-content: center;
      fill: currentColor;
  }
  ```

  Keep a `7px` gap for the expanded chevron button and apply the same gap to the shared button layout. In `panel.css`, replace only `.panel-shell`'s surface values with `rgba(29, 36, 48, 0.68)` and `1px solid rgba(255, 255, 255, 0.17)`; keep inner composer/menu backgrounds unchanged.

- [x] **Step 7: Run focused tests and inspect the diff**

  Run:

  ```text
  npm --prefix desktop run unit-test -- --run tests/desktop/react_overlay.test.tsx
  node --test tests/desktop/test_floating_capsule.mjs tests/desktop/test_frontend_structure.mjs
  git diff --check
  ```

  Expected: all focused tests pass, the accessible names remain `Chat`/`Hide`, and the diff contains only the listed capsule/panel files and tests.

- [x] **Step 8: Commit the implementation**

  ```bash
  git add desktop/ui/capsule/CapsuleApp.tsx desktop/ui/capsule/capsule.css desktop/ui/panel/panel.css tests/desktop/react_overlay.test.tsx tests/desktop/test_floating_capsule.mjs tests/desktop/test_frontend_structure.mjs
  git commit -m "fix: stabilize capsule chat control surface"
  ```

After this task, run the full verification suite and unsigned Windows packaging: `npm --prefix desktop run unit-test`, `npm --prefix desktop run typecheck`, `npm --prefix desktop run build`, `npm --prefix desktop run desktop-test`, and `npm --prefix desktop run dist:win:unsigned`.
