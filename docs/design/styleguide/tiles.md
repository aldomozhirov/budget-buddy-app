# Quick tiles

Rules: UI-HOME-1

Home shows three quick tiles under the banner. Each opens a flow in one tap.

| Class or state | Meaning |
|---|---|
| `.tile` | Icon above a short label, 16 radius. |

**Do**

- Keep to three tiles.

**Don’t**

- Show amounts in tiles.

```html
<div class="grid3">
  <a class="tile" href="#"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>Income</a>
  <a class="tile" href="#"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h15l-3-3"/><path d="M20 16H5l3 3"/></svg>Transfer</a>
  <a class="tile" href="#"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>Check-in</a>
</div>
```
