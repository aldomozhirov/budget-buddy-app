---
name: money-rules
description: The rules for amounts, rounding, formatting, rates, conversion and dates in Budget Buddy. Load before writing, testing or reviewing any code that stores, computes, converts or displays money or check-in dates.
---
# Money rules

The source is `docs/specs/01-foundation-and-wealth.md`, Design sections 3, 5 and 6, and `docs/requirements.md` section 4.2. This is the short form; when a case is not covered here, read those sections rather than guessing.

## Amounts

- An amount is an integer in minor units: `bigint` in code, `INTEGER` in SQLite (read with `safeIntegers`), a decimal-integer string in JSON (`"-198630"`, matching `/^-?\d{1,20}$/`).
- Never floating point. No `parseFloat` and no `Number(` on money paths. `decimal.js` is only for rates and conversion.
- A currency's decimals come from the ISO 4217 table; a coin's from the `coin` table, at most 8.
- One rounding function everywhere: `roundHalfAwayFromZero` (`0.005` gives `0.01`, `−0.005` gives `−0.01`).
- The server never evaluates expressions. It receives minor units and validates them.

## Display

- `€1,234.56` with the currency's own decimals. Minus is U+2212: `−€14.50`.
- Changes: `▲ €1,742.00`, `▼ ₽4,700.00`, or `Unchanged`.
- Dates are `DD/MM/YYYY`.

## Rates and conversion

- Rates are exact decimal strings per (`base`, `quote`, `date`), never deleted.
- `convert` uses the rate of the date or the nearest earlier date, through at most one pivot, with 34 significant digits, and rounds once at the end.
- A missing rate is shown ("Rate missing", total marked incomplete), never guessed.
- Totals across currencies: sum each currency in its own unit, convert each currency total, then add.
- "From exchange rates" takes the rounding remainder, so it and "From balances" add up to the change exactly.

## Balances and time

- Balance at T is the latest snapshot with `taken_at ≤ T`; zero before the first snapshot and from `deactivated_at` on. Use the one `balanceAt` function.
- At the same `taken_at` the source order decides: `connector`, `statement`, `photo`, `checkin`, `manual`, `opening`, `carried_forward`, then the higher `id`.
- Instants are UTC epoch milliseconds. "Today", schedules and day ends are computed in the configured time zone.
- Nothing calls `Date.now()` outside the `Clock`. Tests use a fake clock.

## Tests that must exist (QUA-3)

Rounding, negative balances, missing rates, month ends, leap years, both daylight-saving changes, carried-forward snapshots, values above 2^53, and jobs run twice or late.
