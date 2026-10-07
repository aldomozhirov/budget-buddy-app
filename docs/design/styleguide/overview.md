# Budget Buddy style guide

Tokens, type, icons, motion, components and patterns for the Budget Buddy web app, mobile first. Every example on this page is live markup styled only by `bb.css`; copy its code to get the same result.

| File | What it is for |
|---|---|
| `bb.css` | The stylesheet. Port its tokens and component rules into the app; class names here are the vocabulary the screens use. |
| `fonts/` | Geist 400–700, self-hosted (SEC-7). |
| `screens/`, `index.html` | Every approved screen as static HTML and PNG. |
| `docs/design-spec.md` | The behaviour rules (UI-… IDs) cited on this page. |

Setup: put `class="bb"` on the app root, load `fonts/geist.css` then `bb.css`. The theme follows the system; `bb-light` or `bb-dark` forces one. Use the switch in the sidebar to check both.
