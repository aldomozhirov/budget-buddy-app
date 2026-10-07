# Style guide, by section

Generated from `docs/design/html/styleguide.html` by `docs/design/split-styleguide.py`. Do not edit these files; regenerate them.

Read this index, then open only the sections the task needs. Each section has the rules, the class table, do and don't, and copyable markup. To see a component rendered, open `docs/design/html/styleguide.html` or `components.html` in a browser. The classes are defined in `docs/design/html/bb.css`, which wins over any export.

| Section | Design rules | Classes |
|---|---|---|
| [Budget Buddy style guide](overview.md) |  |  |
| [Principles](principles.md) |  |  |
| [Colour](colour.md) |  |  |
| [Typography](type.md) |  |  |
| [Spacing and shape](shape.md) |  |  |
| [Icons](icons.md) |  |  |
| [Motion](motion.md) |  | `.enter-fwd` `.enter-back` `.sheet` `.scrim` `.progress` `.chart-line` `.success-icon` `.shake` `.expand` `.(any button)` |
| [Writing and formats](writing.md) |  |  |
| [Accessibility](a11y.md) |  |  |
| [Buttons](buttons.md) | UI-ADD-7, UI-NAV-4 | `.primary` `.primary:disabled` `.secondary` `.secondary-sm` `.danger` `.text-btn` |
| [Icon buttons](icon-buttons.md) | UI-NAV-1, UI-NAV-2, UI-HOME-3, UI-A11Y-1 | `.icon-btn` `.icon-btn-ink` `.sheet .icon-btn` |
| [Quick tiles](tiles.md) | UI-HOME-1 | `.tile` |
| [Choice chips](chips.md) | UI-ADD-2, UI-ADD-4, UI-ADD-5, UI-VIS-2 | `.chip` `.chip-sm` `.chip-ghost` `.hrow` |
| [Suggestion and filter chips](suggest.md) | UI-TXN-1, UI-TXN-3, UI-SUM-3 | `.chip-suggest` `.fchip` `.pill` |
| [Segmented control](segmented.md) | UI-ADD-1, UI-ACC-1, UI-A11Y-2 | `.segmented` `.seg[aria-selected="true"]` `.segmented-sm` |
| [Switch and tick box](switch.md) | UI-AUTH-5, UI-SET-1, UI-TXN-3 | `.switch[aria-checked]` `.opt` `.box[aria-checked], .opt[aria-checked] .box` |
| [Merchant field and meta tiles](fields.md) | UI-ADD-3, UI-ADD-6 | `.field-btn` `.meta` `.meta-set` |
| [Detail rows](detail-fields.md) | UI-TXN-4, UI-TXN-5 | `.field` `.field-link` `.expand` |
| [Text, search and password](text-inputs.md) | UI-AUTH-3, UI-TXN-1 | `.text` `.search` `.pw` `.error[role="alert"]` `.shake` |
| [Amount and keypad](keypad.md) | UI-AMT-1 to UI-AMT-4, ACC-9 | `.amount` `.amount-expr` `.keypad` `.key / .key-op` |
| [Cards and banner](cards.md) | UI-ENV-1, UI-HOME-5, UI-SUM-2 | `.card` `.card-hero` `.card-warn` `.banner` `.progress / .progress-over` |
| [List rows, tags and badges](rows.md) | UI-ACC-1, UI-TXN-2, UI-CHK-3 | `.row` `.tag` `.tag-warn` `.badge` |
| [Hidden amounts](masked.md) | UI-HOME-2, UI-HOME-3, DSH-1 | `.masked` |
| [Sheets](sheets.md) | UI-NAV-4, UI-CHK-7, UI-TXN-8 | `.scrim` `.sheet` `.sheet-handle / .sheet-head` |
| [Top bar](topbar.md) | UI-NAV-1, UI-NAV-2 | `.topbar` `.t-title / .t-sub` |
| [Pattern: private Home](p-home.md) | UI-HOME-1 to UI-HOME-6 |  |
| [Pattern: category and envelope on Add expense](p-add.md) | UI-ADD-8 to UI-ADD-12, CAT-5 |  |
| [Pattern: confirm and undo](p-confirm.md) | UI-NAV-4, UI-ADD-13, UI-TXN-3 |  |
| [Pattern: empty, offline and error states](p-empty.md) | UI-ADD-14, UI-TXN-3, CHK-12 |  |
