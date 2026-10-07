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
