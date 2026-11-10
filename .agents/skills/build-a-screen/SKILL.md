---
name: build-a-screen
description: The steps for building or changing a screen in Budget Buddy's web app, from design references to states and accessibility. Load at the start of any task whose files are under web/src/screens/.
---
# Building a screen

Read in this order, and only these:

1. The task in the spec, and the screen's row in the spec's "Screens" table (Design section 8).
2. The screen's section in `docs/design-spec.md` (the task's `UI-…` refs name it). Read that section, not the whole file.
3. `docs/design/html/screens/<Screen>.png` to see it, then `<Screen>.html` for structure, spacing and copy.
4. The `design-system` skill, and through it only the style guide sections for the components this screen uses.

Then build:

1. Compose the screen from the components in `web/src/components/`. Add a component only when the style guide has one that is not built yet.
2. Use the copy from the design spec word for word.
3. Build every state the design spec names, not only the one in the export: loading, empty, error, offline, sheet open, amounts hidden and revealed.
4. Every amount field uses the keypad. The system keyboard never opens for amounts.
5. Back follows UI-NAV-2: the label names where it goes, and it falls back to the screen's parent.
6. Accessibility: every icon-only button has a name, touch targets are at least 44 × 44, and reduced motion turns transitions off.
7. Check it at 390 × 844 and at 820 × 1180.

When the design spec and the requirements disagree, stop and ask the owner. Do not pick one.
