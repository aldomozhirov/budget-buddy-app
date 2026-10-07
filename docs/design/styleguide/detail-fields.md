# Detail rows

Rules: UI-TXN-4, UI-TXN-5

On a transaction page each field is a row that opens in place. A row that opens another screen has a right-pointing chevron instead.

| Class or state | Meaning |
|---|---|
| `.field` | Row with label and value; chevron turns when [aria-expanded="true"]. |
| `.field-link` | Opens another screen. |
| `.expand` | Content shown when a row opens. |

**Do**

- Save each change as it is made and log it in the Record (MEM-5).

**Don’t**

- Send the member to a separate edit screen.

```html
<div class="card">
  <button class="field" aria-expanded="true" data-expand><span class="field-l">Category</span><span class="field-v">Groceries</span></button>
  <div class="cluster expand" style="padding: 4px 0 14px; border-bottom: 1px solid var(--line)" role="radiogroup" aria-label="Category" data-radio>
    <button class="chip chip-sm" role="radio" aria-checked="true">Groceries</button><button class="chip chip-sm" role="radio" aria-checked="false">Household</button><button class="chip chip-sm" role="radio" aria-checked="false">Eating out</button>
  </div>
  <button class="field" aria-expanded="false" data-expand><span class="field-l">Envelope</span><span class="field-v">Groceries</span></button>
  <a class="field field-link" href="#"><span class="field-l">Paid from</span><span class="field-v">ING Visa · EUR</span></a>
  <button class="field" aria-expanded="false" style="border-bottom: 0" data-expand><span class="field-l">Note</span><span class="field-v muted">Add a note</span></button>
</div>
```
