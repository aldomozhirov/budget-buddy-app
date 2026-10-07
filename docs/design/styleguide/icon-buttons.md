# Icon buttons

Rules: UI-NAV-1, UI-NAV-2, UI-HOME-3, UI-A11Y-1

Round 44-point buttons in the top bar: Back, Close, the eye, and add. Every one has an accessible label that says what it does or where it goes.

| Class or state | Meaning |
|---|---|
| `.icon-btn` | 44 × 44, surface fill. |
| `.icon-btn-ink` | The one add action of a list screen. |
| `[aria-pressed="true"]` | Eye while amounts are visible: accent-soft fill. |
| `.sheet .icon-btn` | Close inside a sheet uses the bg fill. |

**Do**

- Name the destination: "Back to check-ins", not "Back".

**Don’t**

- Use an icon button without aria-label.

```html
<div class="cluster">
  <button class="icon-btn" aria-label="Back to home"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
  <button class="icon-btn" aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  <button class="icon-btn" aria-label="Show amounts for 30 seconds" aria-pressed="false" data-eye><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg></button>
  <button class="icon-btn icon-btn-ink" aria-label="New account"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
</div>
```
