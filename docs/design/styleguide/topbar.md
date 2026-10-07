# Top bar

Rules: UI-NAV-1, UI-NAV-2

Back on the left, title and subtitle, then up to two icon buttons. 48 px above it on iPhone for the status bar.

| Class or state | Meaning |
|---|---|
| `.topbar` | Row with safe-area top padding. |
| `.t-title / .t-sub` | Title and subtitle. |

**Do**

- Return to where the member came from (UI-NAV-2).

**Don’t**

- Hard-code the Back target.

```html
<div class="topbar sg-topbar">
  <a class="icon-btn" href="#" aria-label="Back to home"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></a>
  <div style="flex: 1; display: flex; flex-direction: column"><h1 class="t-title">Envelopes</h1><span class="t-sub">October · next top-up on 1 November</span></div>
  <button class="icon-btn" aria-label="New envelope"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
</div>
```
