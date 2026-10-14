# Detail rows

Rules: UI-TXN-4, UI-TXN-5, UI-NAV-7

On a transaction page each field is a row, in the order of the Add form. Every row ends in a right chevron and opens a sheet: the same searchable list, calendar or text box that Add expense uses. Paid from opens the account.

| Class or state | Meaning |
|---|---|
| `.field` | Row with label, value and a right chevron; [aria-haspopup="dialog"] when it opens a sheet. |
| `.field-link` | Opens another screen. |

**Do**

- Open the same sheet the Add form uses for that field, and save each change as it is made, logged in the Record (MEM-5).

**Don’t**

- Open chips in place under the row, or send the member to a separate edit screen.

```html
<div class="card">
  <a class="field field-link" href="#"><span class="field-l">Paid from</span><span class="field-v">ING Visa · EUR</span></a>
  <button class="field" aria-haspopup="dialog"><span class="field-l">Merchant</span><span class="field-v">REWE</span></button>
  <button class="field" aria-haspopup="dialog"><span class="field-l">Category</span><span class="field-v">Groceries</span></button>
  <button class="field" aria-haspopup="dialog"><span class="field-l">Envelope</span><span class="field-v num">Groceries · counts as €21.40</span></button>
  <button class="field" aria-haspopup="dialog"><span class="field-l">Date</span><span class="field-v num">05/10/2026</span></button>
  <button class="field" aria-haspopup="dialog"><span class="field-l">Paid by</span><span class="field-v">Alena</span></button>
  <button class="field" aria-haspopup="dialog" style="border-bottom: 0"><span class="field-l">Note</span><span class="field-v muted">Add a note</span></button>
</div>
```
