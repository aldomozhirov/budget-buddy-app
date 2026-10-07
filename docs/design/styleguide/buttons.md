# Buttons

Rules: UI-ADD-7, UI-NAV-4

One primary button per screen, at the bottom, full width. Its label says what happens and includes the amount when there is one.

| Class or state | Meaning |
|---|---|
| `.primary` | Main action. 56 high, ink fill. |
| `.primary:disabled` | Not possible yet; the label says why ("Enter an amount"). |
| `.secondary` | Second action on a result screen. |
| `.secondary-sm` | Pair of actions in a grid, 52 high. |
| `.danger` | Destructive; always confirmed in a sheet. |
| `.text-btn` | Way out of a sheet. |

**Do**

- Use a verb that says what happens: "Close check-in", "Relabel as USD".
- Keep the primary button reachable by thumb at the bottom.

**Don’t**

- Put two primary buttons on one screen.
- Use "OK" or "Submit".

```html
<div class="stack">
  <button class="primary"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add expense</button>
  <button class="primary">Save €23.80</button>
  <button class="primary" disabled>Enter an amount</button>
  <button class="secondary">Add another</button>
  <div class="grid2">
    <button class="secondary secondary-sm"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h15l-3-3"/><path d="M20 16H5l3 3"/></svg>Move money</button>
    <button class="secondary secondary-sm danger">Delete</button>
  </div>
  <button class="text-btn">Keep it open</button>
</div>
```
