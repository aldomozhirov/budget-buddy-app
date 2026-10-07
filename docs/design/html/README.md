# Budget Buddy: HTML and CSS reference

Static HTML exports of the approved prototype, plus the consolidated stylesheet. Generated on 2026-10-06 from `docs/design/prototype/`. The rules behind them are in `docs/design-spec.md`.

| Path | What it is | Use it for |
|---|---|---|
| `bb.css` | The design system as one stylesheet: colour tokens (light and dark, following the system), type, layout, buttons, chips, segmented control, switch, fields, keypad, cards, rows, tags, progress bars, sheets and motion. | **The styling to build on.** Port its tokens and component rules into the app's styles. Where a screen export and `bb.css` differ, `bb.css` wins. |
| `styleguide.html` | **Style guide and component library for developers**: principles, colour tokens with contrast ratios, type scale, spacing and radii, icon set (click to copy SVG), motion table, writing and formats, accessibility, 16 components with live demos, class tables, do and don’t, copyable markup, and the main patterns. Light, dark and system themes. | Start here when building UI. |
| `components.html` | Every `bb.css` component rendered in light and dark from the same markup. | Seeing what a class looks like and which markup and ARIA attributes it expects. |
| `screens/<Screen>.html` | Each screen rendered to plain HTML in its default state, with the prototype's own CSS and inline styles. No scripts. | Exact layout, spacing, copy and structure of a screen. Open it in a browser at 390 × 844. |
| `screens/<Screen>.png` | Screenshot of the same, at 2× (780 × 1688). | Looking at the screen without a browser. |
| `index.html` | Gallery of all screens. | Browsing. |
| `fonts/` | Geist 400 to 700 (latin subset) with `geist.css` and the SIL Open Font License. | Self-hosting the font; the app must not load fonts from a third party (SEC-7). |

How to use these files:

- Treat the screen exports as a picture in code: copy structure, measurements and copy, not markup. The exports keep the prototype's inline styles and its per-screen class names, which differ slightly between screens; `bb.css` resolves those differences into one set of classes.
- Each export shows one state with invented data. Other states (sheets open, errors, offline, hidden or revealed amounts) are in the variant screens or described in `docs/design-spec.md`.
- The screens are in the light appearance. Swap `bb-light` for `bb-dark` on the root element to see them dark.
- Icons are inline SVG outline icons (stroke 1.8 to 2); see design spec UI-VIS-6.
- Do not edit these files by hand. If the prototype changes, refresh `docs/design/prototype/` and regenerate this folder.
