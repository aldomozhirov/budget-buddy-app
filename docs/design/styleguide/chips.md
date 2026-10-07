# Choice chips

Rules: UI-ADD-2, UI-ADD-4, UI-ADD-5, UI-VIS-2

One-tap choices for account, category and envelope. A row scrolls sideways to the screen edges. Selected means ink fill. Tapping a selected category or envelope chip clears it.

| Class or state | Meaning |
|---|---|
| `.chip` | 44 high on a page. |
| `.chip-sm` | 40 high inside a sheet or card; bg fill. |
| `[aria-checked="true"]` | Selected: ink fill, on-ink text. |
| `.chip-ghost` | "All…" or "Other…": opens a search sheet. |
| `.hrow` | Sideways-scrolling row that runs to the screen edges. |

**Do**

- Put the most used options first; a choice picked from search moves to the front.

**Don’t**

- Add a "None" chip on the add form; an empty choice already means none (UI-ADD-5).

```html
<div class="stack">
  <span class="lbl">Paid from</span>
  <div class="hrow" role="radiogroup" aria-label="Paid from" data-radio>
    <button class="chip" role="radio" aria-checked="true">ING Visa</button>
    <button class="chip" role="radio" aria-checked="false">Cash €</button>
    <button class="chip" role="radio" aria-checked="false">Revolut</button>
    <button class="chip" role="radio" aria-checked="false">Wise $</button>
    <button class="chip chip-ghost">All…</button>
  </div>
  <span class="lbl">Envelope · optional</span>
  <div class="hrow" role="radiogroup" aria-label="Envelope" data-radio data-clearable>
    <button class="chip" role="radio" aria-checked="false">Groceries</button>
    <button class="chip" role="radio" aria-checked="false">Eating out</button>
    <button class="chip" role="radio" aria-checked="false">Unexpected</button>
  </div>
  <span class="lbl">In a sheet or card</span>
  <div class="cluster" role="radiogroup" aria-label="Paid by" data-radio>
    <button class="chip chip-sm" role="radio" aria-checked="true">Alena</button>
    <button class="chip chip-sm" role="radio" aria-checked="false">Max</button>
    <button class="chip chip-sm" role="radio" aria-checked="false">Sofia</button>
  </div>
</div>
```
