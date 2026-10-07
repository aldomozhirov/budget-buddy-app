# Segmented control

Rules: UI-ADD-1, UI-ACC-1, UI-A11Y-2

Switches between two to four views or kinds. It is a tab list.

| Class or state | Meaning |
|---|---|
| `.segmented` | Soft track. |
| `.seg[aria-selected="true"]` | Selected segment on surface with a light shadow. |
| `.segmented-sm` | 32 high, inside cards. |

**Do**

- Keep labels to one or two words.

**Don’t**

- Use it for actions.

```html
<div class="stack">
  <div class="segmented" role="tablist" aria-label="Kind" data-tabs>
    <button class="seg" role="tab" aria-selected="true">Expense</button>
    <button class="seg" role="tab" aria-selected="false">Income</button>
    <button class="seg" role="tab" aria-selected="false">Transfer</button>
  </div>
  <div class="segmented segmented-sm" role="tablist" aria-label="Rates" data-tabs>
    <button class="seg" role="tab" aria-selected="true">Rate of each date</button>
    <button class="seg" role="tab" aria-selected="false">Today’s rates</button>
  </div>
</div>
```
