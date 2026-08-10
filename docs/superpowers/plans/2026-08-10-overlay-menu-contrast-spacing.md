# Overlay Menu Contrast and Capsule Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the floating capsule controls less cramped and restore readable dark styling for the Ant Design workspace dropdown.

**Architecture:** Keep the existing Ant Design `Dropdown` and capsule components. Correct the CSS boundary to target Ant Design's Dropdown-specific class names, then add source-level regression assertions for the selectors and shared spacing token.

**Tech Stack:** React, TypeScript, Ant Design, CSS, Vitest, Node test runner, Vite.

## Global Constraints

- Keep the floating overlay transparent outside its capsule/panel surfaces.
- Keep the existing fixed capsule width and Chat/Hide behavior.
- Do not reintroduce nested interactive controls inside menu items.
- Do not change backend, IPC, model, or packaging behavior.

---

### Task 1: Add regression coverage for overlay spacing and Dropdown selectors

**Files:**
- Modify: `tests/desktop/test_floating_capsule.mjs`
- Modify: `tests/desktop/test_frontend_structure.mjs`

- [ ] Add assertions that the capsule button declares `gap: 10px` and that the old 7px spacing is absent.
- [ ] Add assertions that the workspace menu stylesheet contains `.ant-dropdown-menu`, `.ant-dropdown-menu-item`, and `.ant-dropdown-menu-item-group-title` rules with dark-surface/readable-text declarations.
- [ ] Run the focused tests and confirm they fail against the current CSS.

### Task 2: Apply the minimal CSS fix

**Files:**
- Modify: `desktop/ui/capsule/capsule.css`
- Modify: `desktop/ui/panel/panel.css`

- [ ] Change the shared capsule button gap from `7px` to `10px` and remove the redundant state-specific gap override.
- [ ] Rename the menu selectors from Ant Design `Menu` class names to the actual `Dropdown` class names while preserving existing colors and interaction states.
- [ ] Add an explicit Dropdown menu background and text color so Ant Design light tokens cannot turn the menu white.

### Task 3: Verify and build

**Files:**
- No source changes expected.

- [ ] Run focused frontend tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run unit-test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and inspect the final diff for scope.
- [ ] Commit the scoped source/tests/docs changes.
