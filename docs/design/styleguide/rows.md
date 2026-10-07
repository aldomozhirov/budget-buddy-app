# List rows, tags and badges

Rules: UI-ACC-1, UI-TXN-2, UI-CHK-3

Rows are at least 56 high and divided by line. Tags mark state in words. A badge counts what waits.

| Class or state | Meaning |
|---|---|
| `.row` | List row; .row-l holds title and meta. |
| `.tag` | Neutral state ("Inactive", "Transfer", "Refund"). |
| `.tag-warn` | Warning state ("Stale", "No category"). |
| `.badge` | Count of items waiting. |

**Do**

- Show amounts with .num so digits line up.

**Don’t**

- Rely on opacity alone to mean inactive; add the tag.

```html
<div class="card">
  <a class="row" href="#"><span class="row-l"><span style="font-weight: 500">Revolut · EUR</span><span class="t-sub">Check-in 02/09/2026</span></span><span style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px"><span class="num" style="font-weight: 500">€386.20</span><span class="tag tag-warn">Stale</span></span></a>
  <a class="row" href="#" style="opacity: .6"><span class="row-l"><span style="font-weight: 500">Tinkoff Black · RUB</span><span class="t-sub">By hand 11/03/2026</span></span><span style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px"><span class="num" style="font-weight: 500">₽0.00</span><span class="tag">Inactive</span></span></a>
  <div class="row"><span class="row-l"><span style="font-weight: 500">ING Girokonto · EUR</span><span class="t-sub">Last €1,986.30 on 02/09/2026</span></span><button class="chip chip-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Same</button></div>
  <a class="row" href="#"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4h8l9 9-8 8-9-9z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg><span class="row-l">Needs a category</span><span class="badge">3</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>
</div>
```
