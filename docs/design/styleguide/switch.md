# Switch and tick box

Rules: UI-AUTH-5, UI-SET-1, UI-TXN-3

A switch turns a setting on or off at once. A tick box selects rows for a bulk action.

| Class or state | Meaning |
|---|---|
| `.switch[aria-checked]` | 51 × 31; accent when on. |
| `.opt` | Option row in a sheet, at least 52 high. |
| `.box[aria-checked], .opt[aria-checked] .box` | Tick box; .box-radio for a round one. |

**Do**

- Apply a switch immediately.

**Don’t**

- Ask "Save" after flipping a switch.

```html
<div class="card">
  <div class="row"><span class="row-l"><span style="font-weight: 500">Unlock with Face ID</span><span class="t-sub">On this iPhone, instead of the password</span></span>
    <button class="switch" role="switch" aria-checked="true" aria-label="Unlock with Face ID" data-switch><span class="knob"></span></button></div>
  <div class="row"><span class="row-l"><span style="font-weight: 500">Hide amounts on Home</span><span class="t-sub">Tap the eye to show them for 30 s</span></span>
    <button class="switch" role="switch" aria-checked="false" aria-label="Hide amounts on Home" data-switch><span class="knob"></span></button></div>
  <button class="opt" role="checkbox" aria-checked="true" data-switch><span class="box"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span style="flex: 1">Groceries</span><span class="t-sub">2</span></button>
  <button class="opt" role="checkbox" aria-checked="false" data-switch style="border-bottom: 0"><span class="box"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span style="flex: 1">Eating out</span><span class="t-sub">0</span></button>
</div>
```
