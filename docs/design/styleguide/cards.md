# Cards and banner

Rules: UI-ENV-1, UI-HOME-5, UI-SUM-2

Content sits on surface cards on the bg page. The overspent envelope gets a warn outline. The open check-in banner uses accent-soft and never shows amounts.

| Class or state | Meaning |
|---|---|
| `.card` | Group of rows, 18 radius, 14 side padding. |
| `.card-hero` | Big figure card, 20 radius. |
| `.card-warn` | Overspent outline. |
| `.banner` | Open check-in; accent-soft. |
| `.progress / .progress-over` | Bar; warn when over. |

**Do**

- Pair colour with words: "overspent", "Over budget".

**Don’t**

- Use warn for anything but overspending, staleness and errors.

```html
<div class="stack">
  <div class="banner"><span style="display: flex; justify-content: space-between"><span style="font-weight: 600">Monthly check-in is open</span><span class="link">Continue</span></span><span class="progress"><span style="width: 57%"></span></span><span class="t-sub">Opened today · 4 of your accounts to check</span></div>
  <a class="card-hero" href="#">
    <span style="display: flex; justify-content: space-between"><span style="font-weight: 600; font-size: 17px">Groceries</span><span class="tag tag-mode">Resets monthly</span></span>
    <span class="t-hero-sm num">€187.60 <span class="muted" style="font-size: 15px; font-weight: 500; letter-spacing: 0">left</span></span>
    <span class="progress"><span style="width: 62%"></span></span>
    <span class="t-sub num">€312.40 spent of €500.00 · 6 expenses</span>
  </a>
  <a class="card-hero card-warn" href="#">
    <span style="display: flex; justify-content: space-between"><span style="font-weight: 600; font-size: 17px">Eating out</span><span class="tag tag-mode">Resets monthly</span></span>
    <span class="t-hero-sm num warn">−€14.50 <span style="font-size: 15px; font-weight: 500; letter-spacing: 0">overspent</span></span>
    <span class="progress progress-over"><span style="width: 100%"></span></span>
    <span class="t-sub num">€214.50 spent of €200.00 · 4 expenses</span>
  </a>
</div>
```
