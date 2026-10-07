# Text, search and password

Rules: UI-AUTH-3, UI-TXN-1

Text inputs are 52 high (password 56). Inside a sheet they use the bg fill. An error turns the border warn and shows a message announced to screen readers.

| Class or state | Meaning |
|---|---|
| `.text` | Single-line text. |
| `.search` | With a search icon in .input-wrap. |
| `.pw` | Password with a show/hide .input-btn. |
| `[aria-invalid="true"]` | Error border. |
| `.error[role="alert"]` | Error message. |
| `.shake` | Wrong password feedback. |

**Do**

- Say what is wrong and what happens next.

**Don’t**

- Use the system keyboard for amounts (UI-AMT-1).

```html
<div class="stack">
  <div class="input-wrap"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg><input class="search" type="search" placeholder="Search merchant, note, amount" aria-label="Search transactions"></div>
  <input class="text" placeholder="Name the account" aria-label="Name">
  <div class="input-wrap"><input class="pw shake" type="password" value="wrongpass" aria-label="Family password" aria-invalid="true" aria-describedby="pw-err"><button class="input-btn" aria-label="Show password"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
  <span class="error" id="pw-err" role="alert">That password doesn’t match. 2 tries before a short wait.</span>
</div>
```
