# Capsule Chat Symbol and Shared Opacity Design

## Goal

Keep the floating capsule visually stable when switching between its closed `Chat` state and expanded `Hide` state, while making the expanded panel as transparent as the capsule shell.

## Approved direction

- The closed action reads `Chat` with the supplied paw SVG from `C:\Users\EDY\Downloads\爪子.svg` immediately before the label.
- The paw is rendered as an inline SVG in the fixed-width icon slot, preserving its `viewBox="0 0 1259 1024"` and path artwork. The SVG is decorative and hidden from assistive technology.
- The expanded action keeps the existing SVG chevron and reads `⌄ Hide` visually (the chevron remains the SVG path already used by the capsule; the glyph notation here describes the appearance, not a literal text character).
- Both states use the same fixed action-button width, height, icon slot, gap, and text sizing so the capsule does not resize or visually jump.
- The expanded panel shell uses the same surface color and alpha as the capsule shell: `rgba(29, 36, 48, 0.68)`. Its border uses the capsule border treatment: `1px solid rgba(255, 255, 255, 0.17)`.
- Inner composer and menu surfaces remain layered darker surfaces; only the expanded panel shell is synchronized with the capsule surface.

## Interaction and accessibility

The existing `toggle-workspace` intent and `aria-expanded` state remain unchanged. The decorative paw SVG and SVG chevron are `aria-hidden="true"`; the button's accessible name remains `Chat` or `Hide`.

## Verification

Add regression coverage for both source contracts and React behavior: the closed action contains the supplied paw SVG slot, the expanded action contains the chevron and `Hide`, both states share the fixed button geometry, and the panel shell declares the exact shared surface/background and border values. Existing unit, typecheck, build, desktop, and packaging checks remain required.
