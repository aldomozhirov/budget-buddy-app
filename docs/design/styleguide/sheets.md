# Sheets

Rules: UI-NAV-4, UI-CHK-7, UI-TXN-8

Pickers, filters, short forms and confirmations open as bottom sheets over a dimmed page. A confirmation states the consequence before the action. (Shown in place here; in the app it is fixed to the bottom with .scrim behind it.)

| Class or state | Meaning |
|---|---|
| `.scrim` | Dimmed layer; a tap closes the sheet. |
| `.sheet` | Bottom sheet, 24 top radius, slides up. |
| `.sheet-handle / .sheet-head` | Drag handle; title row with Close. |

**Do**

- Trap focus in the sheet and return it on close.

**Don’t**

- Use a centred modal dialog.

```html
<div class="sheet sg-inline-sheet" role="dialog" aria-modal="true" aria-labelledby="sg-sheet-t">
  <div class="sheet-handle" aria-hidden="true"></div>
  <div class="sheet-head"><h3 class="t-sheet" id="sg-sheet-t" style="flex: 1">Close the check-in now?</h3><button class="icon-btn" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
  <p class="t-sub" style="margin: 0">3 accounts without a value will keep the last balance, marked as “wasn’t changed”.</p>
  <button class="primary">Close check-in</button>
  <button class="text-btn">Keep it open</button>
</div>
```

A picker sheet lists the full set behind a chip row’s “All…” or “Other…”, or behind a detail row. It searches when the list is long and can be split into groups whose headings are `.t-group` labels, clearly apart from the rows (UI-VIS-9). The selected row has a check.

| Class or state | Meaning |
|---|---|
| `.t-group` | Group heading in a sheet list: 11 px uppercase, 20 above. |
| `.opt[aria-checked]` | One choice; a check marks the selected one. |
| `.cal / .day` | Date sheet: month grid, future days disabled, then a “Today” button. |

**Do**

- Use the same sheet for a field wherever it is picked: Add expense, the transaction page, the envelope form.

**Don’t**

- Style a group heading like a row, or put a long list in chips.

```html
<div class="sheet sg-inline-sheet" role="dialog" aria-modal="true" aria-labelledby="sg-pick-t">
  <div class="sheet-handle" aria-hidden="true"></div>
  <div class="sheet-head"><h3 class="t-sheet" id="sg-pick-t" style="flex: 1">Category</h3><button class="icon-btn" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
  <div class="input-wrap"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg><input class="search" type="search" placeholder="Search or add a category" aria-label="Search or add a category"></div>
  <div role="radiogroup" aria-label="Recent">
    <h4 class="t-group">Recent</h4>
    <button class="opt" role="radio" aria-checked="true"><span style="flex: 1; font-weight: 500">Groceries</span></button>
    <button class="opt" role="radio" aria-checked="false"><span style="flex: 1; font-weight: 500">Eating out</span></button>
  </div>
  <div role="radiogroup" aria-label="All categories">
    <h4 class="t-group">All categories</h4>
    <button class="opt" role="radio" aria-checked="false"><span style="flex: 1; font-weight: 500">Fees and taxes</span></button>
    <button class="opt" role="radio" aria-checked="false" style="border-bottom: 0"><span style="flex: 1; font-weight: 500">Gifts</span></button>
  </div>
</div>
```
