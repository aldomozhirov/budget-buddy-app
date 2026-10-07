# Hidden amounts

Rules: UI-HOME-2, UI-HOME-3, DSH-1

Home hides amounts every time it opens. The eye shows them for 30 seconds. While hidden, show shares and directions, never partial digits. Try the eye.

| Class or state | Meaning |
|---|---|
| `.masked` | Currency symbol and dots: "€ • • • • •". |
| `[aria-pressed] on the eye` | true while revealed; label "Hide amounts". |

**Do**

- Hide again after 30 seconds and on every app open.
- Give the masked figure an accessible label such as "Amount hidden".

**Don’t**

- Store the revealed state.
- Put amounts in notifications or the check-in banner (NTF-4).

```html
<div class="stack" data-privacy>
  <div style="display: flex; align-items: center; gap: 12px">
    <span style="flex: 1" class="t-sub" data-note>Amounts hidden</span>
    <button class="icon-btn" aria-label="Show amounts for 30 seconds" aria-pressed="false" data-eye><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg></button>
  </div>
  <div class="card"><div class="row"><span class="row-l"><span style="font-weight: 500">Family wealth · EUR</span><span class="t-sub" data-h="+€1,742 since check-in of 02/09/2026">Hidden · last check-in 02/09/2026</span></span><span class="num masked" style="font-weight: 600; font-size: 20px" data-h="€84,215">€ • • • • •</span></div>
  <div class="row"><span class="row-l"><span style="font-weight: 500">Eating out</span></span><span class="t-sub warn" data-h="€14.50 over">Over budget</span></div>
  <div class="row"><span class="row-l"><span style="font-weight: 500">Groceries</span></span><span class="t-sub" data-h="€187.60 left of €500">62% used</span></div></div>
</div>
```
