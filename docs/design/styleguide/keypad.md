# Amount and keypad

Rules: UI-AMT-1 to UI-AMT-4, ACC-9

Every amount is typed on this keypad. The expression shows above the result once it has an operator; the result rounds to the currency. Try it.

| Class or state | Meaning |
|---|---|
| `.amount` | Result, 46 px, tabular. |
| `.amount-expr` | Expression line. |
| `.keypad` | 5 columns, 6 px gap. |
| `.key / .key-op` | Digit key / operator key (soft fill). 42 high on a page, 48 in a sheet. |

**Do**

- Store the result in minor units (AGENTS.md).
- Offer "Start from last" for balances (UI-AMT-4).

**Don’t**

- Use floating point to calculate.

```html
<div class="stack" data-calc>
  <div style="text-align: center">
    <div class="amount-expr" data-expr>&nbsp;</div>
    <div class="amount" data-result style="color: var(--muted)">€0</div>
    <div class="error" data-err role="alert"></div>
  </div>
  <div class="keypad">
    <button class="key">7</button><button class="key">8</button><button class="key">9</button><button class="key key-op" aria-label="Open bracket">(</button><button class="key key-op" aria-label="Close bracket">)</button>
    <button class="key">4</button><button class="key">5</button><button class="key">6</button><button class="key key-op" aria-label="Multiply">×</button><button class="key key-op" aria-label="Divide">÷</button>
    <button class="key">1</button><button class="key">2</button><button class="key">3</button><button class="key key-op" aria-label="Plus">+</button><button class="key key-op" aria-label="Minus">−</button>
    <button class="key" aria-label="Decimal point">.</button><button class="key">0</button><button class="key key-op" aria-label="Percent">%</button><button class="key key-op" aria-label="Delete">⌫</button><button class="key key-op" aria-label="Clear">C</button>
  </div>
  <button class="primary" disabled data-save>Enter an amount</button>
</div>
```
