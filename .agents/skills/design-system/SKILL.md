---
name: design-system
description: How to find and use Budget Buddy's design system (bb.css classes, tokens, components, icons, motion, copy formats). Load before writing or reviewing any markup or styling.
---
# Design system

The design system is `docs/design/html/bb.css`. The style guide explains it, one small file per section.

## How to read it

1. Open `docs/design/styleguide/README.md`. It is the index: each section with its design rule IDs and the classes it covers.
2. Open only the section files the task needs (for example `buttons.md`, `sheets.md`, `keypad.md`). Each has the rules, a class table, do and don't, and copyable markup with the expected ARIA attributes.
3. Do not read `docs/design/html/styleguide.html`. It is the same content at about ten times the size, kept for viewing in a browser.
4. Read `bb.css` itself when you port or check a rule's exact values.

## Rules

- Where a screen export and `bb.css` differ, `bb.css` wins.
- Use tokens (`--ink`, `--accent`, `--r-card`), never raw hex values or pixel radii.
- Screen exports in `docs/design/html/screens/` are a picture in code: copy structure, measurements and copy, not their markup or inline styles.
- Do not read `docs/design/prototype/` unless `docs/design-spec.md` section 19 sends you there for a rule in the logic.
- Copy in quotes in the design spec is the intended text. Keep it.
- Icons come from `lucide-vue-next`, bundled (UI-VIS-6); `icons.md` shows the shapes the design expects.
- No fonts, icons or scripts from another origin (SEC-7).

The section files are generated. If the style guide changes, run `python3 docs/design/split-styleguide.py`; never edit them by hand.
