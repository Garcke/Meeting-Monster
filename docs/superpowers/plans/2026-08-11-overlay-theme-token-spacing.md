# Overlay Theme Token and Capsule Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every workspace dropdown label readable without hover and increase capsule icon-label spacing.

**Architecture:** Correct the color source at the overlay `ConfigProvider` by supplying dark-overlay semantic tokens, while leaving the light settings theme unchanged. Adjust only the shared capsule action dimensions and lock both fixes with source-level regressions.

**Tech Stack:** React, TypeScript, Ant Design, CSS, Node test runner, Vitest, Vite, electron-builder.

## Global Constraints

- Keep Electron `43.3.0` and Ant Design dependencies unchanged.
- Keep the settings window on the existing light theme.
- Keep the capsule outer width, height, status area, exit control, and behavior unchanged.
- Do not modify backend, IPC, ASR, model, or menu command behavior.

---

### Task 1: Add failing token and spacing regressions

**Files:**
- Modify: `tests/desktop/test_floating_capsule.mjs`
- Modify: `tests/desktop/test_frontend_structure.mjs`

**Interfaces:**
- Consumes: `overlayTheme` in `desktop/ui/shared/antd-theme.tsx` and `.capsule-button.ant-btn` in `desktop/ui/capsule/capsule.css`.
- Produces: regression assertions for overlay semantic tokens and 76px/14px capsule geometry.

- [ ] Change capsule assertions to require `width: 76px`, `min-width: 76px`, and `gap: 14px`, while rejecting the previous 70px/10px values.
- [ ] Add a theme assertion that the overlay variant defines `colorText: '#EEF2F8'`, `colorTextDescription: 'rgba(230, 237, 248, 0.62)'`, `colorTextDisabled: 'rgba(230, 237, 248, 0.48)'`, `colorBgElevated: '#151B25'`, `controlItemBgHover: 'rgba(121, 185, 255, 0.17)'`, and `controlItemBgActive: 'rgba(121, 185, 255, 0.22)'`.
- [ ] Run `node --test tests/desktop/test_floating_capsule.mjs tests/desktop/test_frontend_structure.mjs` and confirm failures reference the old dimensions and missing overlay tokens.

### Task 2: Implement the root-cause theme and spacing fix

**Files:**
- Modify: `desktop/ui/shared/antd-theme.tsx`
- Modify: `desktop/ui/capsule/capsule.css`

**Interfaces:**
- Consumes: `MeetingMonsterConfigProvider` variant selection and existing capsule JSX.
- Produces: readable overlay-wide Ant Design tokens and shared Chat/Hide geometry.

- [ ] Add the six approved semantic color values directly to `overlayTheme.token` after the common token spread so they override the light common text token only for the overlay.
- [ ] Change `.capsule-button.ant-btn` width and minimum width from 70px to 76px and gap from 10px to 14px.
- [ ] Re-run the focused test command and require 17/17 passing.

### Task 3: Verify, package, and commit

**Files:**
- No additional source files expected.

**Interfaces:**
- Consumes: the completed source and test changes.
- Produces: verified Windows installer and portable artifacts.

- [ ] Run `npm run typecheck` from `desktop` and require exit 0.
- [ ] Run `npm run unit-test` from `desktop` and require all 195 tests to pass.
- [ ] Run `npm run build` from `desktop` and require exit 0.
- [ ] Run `git diff --check` and confirm only the four scoped source/test files changed.
- [ ] Commit only the scoped source/test files; leave `node_modules/` untracked.
