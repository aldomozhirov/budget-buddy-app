# Suggestion and filter chips

Rules: UI-TXN-1, UI-TXN-3, UI-SUM-3

A suggestion chip applies a proposed value in one tap. Filter chips narrow a list and open a sheet. Pills switch a chart series.

| Class or state | Meaning |
|---|---|
| `.chip-suggest` | Suggested value; accent on accent-soft. |
| `.fchip` | Filter chip, 36 high; filled when a filter is active. |
| `.pill` | Chart series switch. |

**Do**

- Show the count of matches in the filter sheet.

**Don’t**

- Apply a model or rule suggestion without a tap (CAT-8).

```html
<div class="stack">
  <div class="cluster"><button class="chip-suggest"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Subscriptions</button><button class="chip chip-sm chip-ghost">Other…</button></div>
  <div class="hrow">
    <button class="fchip" aria-pressed="true">October <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    <button class="fchip" aria-pressed="false">Member <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    <button class="fchip" aria-pressed="false">Account <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
  </div>
  <div class="hrow" role="radiogroup" aria-label="Series" data-radio>
    <button class="pill" role="radio" aria-checked="true">All in EUR</button>
    <button class="pill" role="radio" aria-checked="false">EUR</button>
    <button class="pill" role="radio" aria-checked="false">USD</button>
  </div>
</div>
```
