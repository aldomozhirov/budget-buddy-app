# Icons

Outline icons on a 24 grid, stroke 1.8–2, round caps and joins, drawn in `currentColor`. Sizes 18–22 in buttons, 13–16 inline. Bundle them; no icon CDN. Click an icon to copy its SVG.

Every icon uses this wrapper; the table gives what goes inside it.

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">…</svg>
```

| Name | Use | Inside the wrapper |
|---|---|---|
| back | Back | `<path d="M15 6l-6 6 6 6"/>` |
| forward | Opens a screen (row chevron) | `<path d="M9 6l6 6-6 6"/>` |
| down | Opens a picker | `<path d="M6 9l6 6 6-6"/>` |
| up | Collapse | `<path d="M6 15l6-6 6 6"/>` |
| close | Close | `<path d="M6 6l12 12M18 6L6 18"/>` |
| check | Selected, done | `<path d="M5 12.5l4.5 4.5L19 7.5"/>` |
| plus | Add | `<path d="M12 5v14M5 12h14"/>` |
| search | Search | `<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>` |
| eye | Amounts visible | `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>` |
| eye-off | Amounts hidden | `<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>` |
| checkin | Check-in | `<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>` |
| income | Income | `<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>` |
| transfer | Transfer, move money | `<path d="M4 8h15l-3-3"/><path d="M20 16H5l3 3"/>` |
| transactions | Transactions | `<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>` |
| envelope | Envelopes | `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>` |
| account | Accounts | `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 14.5h2"/>` |
| calendar | Check-ins, date | `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>` |
| chart | Wealth history, history | `<path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/>` |
| tag | Categories, Needs a category | `<path d="M3 12V4h8l9 9-8 8-9-9z"/><circle cx="7.5" cy="7.5" r="1.2"/>` |
| reports | Reports | `<path d="M12 3v9h9"/><path d="M20.5 15A9 9 0 1 1 9 3.5"/>` |
| settings | Settings | `<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>` |
| person | Paid by, profile | `<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>` |
| note | Note, edit | `<path d="M4 20h4L19 9l-4-4L4 16v4z"/>` |
| merchant | Merchant | `<path d="M4 10l1.5-5h13L20 10"/><path d="M4 10v9h16v-9"/><path d="M4 10c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3"/>` |
| offline | Offline | `<path d="M3 3l18 18"/><path d="M9 19h8a4 4 0 0 0 1.6-7.7"/><path d="M6 9.6A5 5 0 0 0 7 19"/>` |
| record | Record, history of a transaction | `<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>` |
| receipt | Attach receipt | `<path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10"/><path d="M17 17v6M14 20h6"/>` |
| faceid | Face ID | `<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1"/><path d="M9.5 16c1.5 1 3.5 1 5 0"/>` |
| wallet | App mark | `<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M15.5 14.5h2.5"/><path d="M7 6V4.5h10V6"/>` |
