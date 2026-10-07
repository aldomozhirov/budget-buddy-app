# Colour

Twelve tokens, each with a light and a dark value. Use the token, never the hex value.

| Token | Light · dark | Use |
|---|---|---|
| `--bg` | #F4F3EF · #111214 | Page background |
| `--surface` | #FFFFFF · #1A1C1F | Cards, rows, chips, keys, sheets |
| `--ink` | #15171A · #F1F0EC | Text, primary buttons, selected chips |
| `--on-ink` | #F4F3EF · #111214 | Text and icons on ink |
| `--muted` | #5C6168 · #A3A8AF | Secondary text, hints, labels |
| `--line` | #E2E0D9 · #2B2E33 | Borders, dividers |
| `--soft` | #EAE8E2 · #24272B | Operator keys, segmented track, disabled buttons, bar tracks |
| `--accent` | #1D5C45 · #7CC6A3 | Progress, positive change, links, switch on |
| `--accent-soft` | #DCEAE3 · #1D3229 | Check-in banner, suggestion chips, revealed eye |
| `--warn` | #A2470F · #F2A574 | Overspent, stale, decreases, errors |
| `--warn-soft` | #F5E2D4 · #3A2618 | Warning tags |
| `--scrim` | rgba(20,20,18,.36) · rgba(0,0,0,.55) | Dimmed page behind a sheet |

## Contrast of text pairs (WCAG 2.1)

| Text on background | Use | Light | Dark |
|---|---|---|---|
| `ink` on `bg` | Body text | 16.2:1 AAA | 16.4:1 AAA |
| `ink` on `surface` | Text on cards | 18.0:1 AAA | 15.0:1 AAA |
| `muted` on `bg` | Secondary text | 5.6:1 AA | 7.8:1 AAA |
| `muted` on `surface` | Secondary text on cards | 6.2:1 AA | 7.1:1 AAA |
| `muted` on `soft` | Labels on segmented track | 5.1:1 AA | 6.3:1 AA |
| `accent` on `surface` | Positive change, links | 7.9:1 AAA | 8.5:1 AAA |
| `accent` on `accent-soft` | Suggestion chip | 6.3:1 AA | 6.8:1 AA |
| `warn` on `surface` | Overspent, errors | 6.1:1 AA | 8.5:1 AAA |
| `warn` on `warn-soft` | Stale tag | 4.9:1 AA | 7.1:1 AAA |
| `on-ink` on `ink` | Primary button | 16.2:1 AAA | 16.4:1 AAA |

## Rules

- Selection is `ink` fill, never accent (UI-VIS-2).
- `warn` only for overspent, stale, decreases on the summary, and errors.
- Colour is never the only signal: changes carry ▲ or ▼, warnings carry words.
