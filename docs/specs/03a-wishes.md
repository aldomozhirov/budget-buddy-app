# Spec 03a: Wishes

Status: written by a build session on 2026-11-13 with the owner's answers of the same day (planning thread of TASK-37). Requirements PLN-9 to PLN-11 and PLN-18, and PLN-14, PLN-16, PLN-17 and PLN-21 for wishes, envelopes and unplanned spending, in `docs/requirements.md` (sections 4.7, 8 "Spec 3a" and 11); design UI-HOME-9, section 9a (UI-WSH-1 to UI-WSH-7) and UI-TXN-10 in `docs/design-spec.md`. The number follows the roadmap (spec 3a); it comes after specs 1 and 2 and before 3b (recurring transactions) and 3c (the month plan), which add to what it builds.

Inputs: `AGENTS.md`, `docs/requirements.md` (sections 4.7 and 11, PLN-9 to PLN-11, PLN-14, PLN-16 to PLN-18, PLN-21, MEM-4, MEM-5, DSH-5, BKP-3), `docs/design-spec.md` (UI-HOME-9, UI-WSH-1 to UI-WSH-7, UI-TXN-4, UI-TXN-5, UI-TXN-7, UI-TXN-10), `docs/design/html/screens/` (`HomeWishes`, `Wishes`, `WishesNew`, `WishesNext`, `WishDetail`, `WishRecord`, `WishLink`, `WishDone`, `TransactionWish`, `TransactionCountsFor`, `TransactionInEnvelope`, `TransactionFx`), `docs/specs/02-spending.md` (D5, Design 2 and 3.3, 3.5, 3.9, 5), `server/src/db/schema.ts` (`txn`, `txn_part`, `txn_revision`, `envelope` as built, migrations up to 0005) and the skill `money-rules`.

## Goal

The family keeps each month's wishes in the app, in place of the shared note. A member adds a wish for this month or a coming one, sees what was spent on it, ticks it off (also from Home), drops it, or moves an open one to another month. A wish becomes an expense in one step ("Add expense", which opens the Add form for the wish; TASK-50), or collects expenses that a member links from the wish or from the transaction's own page, where "Counts for" is one choice among an envelope, a wish of the month and neither. Choosing a wish for an expense charged to an envelope takes it out of the envelope, and every such change is logged. Home has a Wishes row with the count of open wishes. Nothing here is recurring, planned or reviewed: those are specs 3b to 3e.

## Decisions taken with the owner for this spec

| # | Topic | Decision |
|---|---|---|
| D1 | Split expenses | Decided 2026-11-13. Not built (spec 02, D5: one `txn_part` per transaction, "Split" hidden), so this spec ignores them. A link to a wish belongs to the transaction; choosing a wish clears the envelope of its one part, and the removal is logged. TXN-9 (split), when it comes, must decide how a split expense counts for a wish (Out of scope). |
| D2 | Currencies | Decided 2026-11-13. Wishes work like envelopes. An expense in another currency than its wish counts for the wish at its amount converted at the rate of the transaction's date. The converted amount is stored in the wish's minor units with a typed-by-hand flag, and a member can correct it, as "Counts in the envelope as" works (UI-TXN-5, spec 02 section 3.3): recomputed on a change of amount, date, account or wish, which also clears the typed-by-hand flag (spec 02 3.3). Adding an expense for a wish (PLN-18) stores the amount the form prefilled (`linkAmount`). The month's total on Wishes is converted to the common currency at the rate of the month's first day, or the latest stored rate for a coming month (requirements 4.7). |

## Defaults to confirm

Chosen by the planning session where the requirements and the design are silent. Use them unless the owner objects. "Needed by" names the build task (Tasks).

| # | Item | Default | Needed by |
|---|---|---|---|
| O1 | What can be linked | Only a confirmed expense, and a refund (negative expense), can be linked to a wish; an income, a transfer and a draft cannot. A refund counts as a negative amount (requirements 4.7). | 41 |
| O2 | "Fits the wish" (UI-WSH-6) | An expense fits when its category is the wish's category, or when its merchant (compared by `merchant_key`) is the merchant of an expense already linked to the wish. A wish without a category and without links has no "Fits" group; the sheet then shows only "Other expenses in <month>". | 44 |
| O3 | A linked expense whose date leaves the month | Its link is removed, whoever made it, and the removal is logged (requirements 4.7). The check compares the new date's month with the link's `month` (Design 1), not with the wish's, so the rule also holds for a wish that was moved. | 41 |
| O4 | Moving a wish with expenses to any other month (PLN-11) | The wish and its links move together, to an earlier month as well as a later one. Spent stays the sum of its links, so a half-spent wish is half-spent in its new month. Each link keeps the `month` of its expense, so the old month's figures still count it where the expense was made, and the month plan (spec 3c) can use `link.month` for "spent on wishes" and the wish's month for its amount. The "Counts for" sheet lists the wishes of the expense's month, so an expense linked to a wish that has since moved shows no check; the row still names the wish. A new link needs an expense of the wish's current month. This departs from requirements 4.7 ("a wish of its month") for the old links of a moved wish, which is why it is a default to confirm: the alternative is to remove the links on a move and let the old expenses count as unplanned. | 38 |
| O5 | Currency of a wish with expenses | A member may change it. Every link's amount is then recomputed (typed-by-hand flags cleared), and each change is logged on its transaction as a corrected amount (Design 6). The edit form is unchanged. | 38, 41 |
| O6 | Server-side Undo | There is none beyond the inverse call (Design 5). The screens offer Undo for the length of their short message; the server accepts the inverse call at any time as long as the thing it needs still has the state it expects, and answers 409 `changed` otherwise. A deleted wish and its links are kept (marked deleted) and never purged. | 38 |
| O7 | Names | A wish name is 1 to 80 characters after trimming and need not be unique, since the same wish can come back in another month. A note is at most 500 characters. A wish's category is an active expense category; an archived one stays on a wish that already has it. | 38 |
| O8 | Months allowed | From 2000-01 (as dates, spec 02 3.4) to 12 months after the current month. The Wishes switcher and the Month field of the wish form use the same range. | 38 |
| O9 | Wording of the history lines the design has not drawn | "Moved from the wish <wish> to the wish <wish>" (a link moved between wishes), "Recorded from the wish <wish>" (an expense added for a wish, TASK-50) and "Counts for <wish> as €21.40" (a corrected converted amount), each followed by "by <member>" like the four lines of UI-TXN-10. | 41, 43 |
| O10 | Home's open count (UI-HOME-9; replaced by TASK-53 and O16, 2026-11-18) | `GET /api/home` gains `wishes: { open: number }`, so Home stays one request and works with the data it already caches. Limited Home (offline) has no Wishes row. | 38, 39 |
| O11 | Expression (PLN-16) | The client evaluates it; the server stores it as typed and only checks that it is at most 120 characters of digits, spaces, `+ − - × ÷ * / ( ) . ,`. The server never evaluates it and does not require it to equal the amount (money-rules). | 38 |
| O12 | Order of wishes in a month | Open wishes by creation time, oldest first; done and dropped ones after them in the same order. A member cannot reorder wishes. | 38 |
| O13 | A link and the Add form | A transaction created on the Add form has no link, unless it is opened from a wish (`wishId`, TASK-50), when it has the recorded link and no envelope. Neither a rule nor a category's default fills an envelope into a linked expense: filling happens on create only, and labelling from "Needs a category" (spec 02 O7) never fills an envelope into a transaction that has a link. | 41 |
| O14 | Requirements 4.2 rule 3 | The stored `plan_link.amount` is a second exception to "converted figures are never stored". Amend the rule to name wishes beside envelopes. | 38 |
| O15 | Link an expense from an envelope (TASK-51) | The envelope page offers the sheet of UI-WSH-6 on its month tab, for the current month and an active envelope only; an archived envelope is refused with 409 `changed`. An expense fits the envelope when its category is the envelope's default category, or a category whose default envelope is this envelope, or its merchant (by `merchant_key`) is that of an expense already charged to the envelope. Expenses in another currency are offered; the envelope amount is converted as in spec 02 3.3. | 51 |
| O16 | Home's Wishes card data (Design 10) | `wishes.items` on `GET /api/home` lists the current month's open and done wishes, each with `state: 'open' \| 'done'`; dropped and deleted wishes are left out. The order is O12's, so done wishes come after open ones. `wished`, `spent` and `incomplete` are unchanged: they already count every wish that is not dropped, so a tick never changes them. | 54 |
| O17 | Where a ticked wish stays (UI-HOME-10) | Home keeps the order of the rows it has shown for as long as the screen stays open: a tick changes the row from the `PATCH` answer, and a quiet reload (after the outbox sends) keeps the rows it knows in place, puts new wishes at the end and takes away the gone ones. Opening Home again takes the server's order. | 54 |
| O18 | Tick, Undo and failures on Home | As on the wish page: `PATCH` with `state` and `expect: { state: previous }`; the toast stays 8 seconds and a newer one replaces it, with its Undo; Undo is the inverse `PATCH` with `expect: { state: new }` and then says "Undone."; a 409 says "Someone changed it meanwhile." and reloads Home quietly; another failure says the wish page's error and leaves the row as it was. While its call runs, a row's tick is disabled. | 54 |
| O19 | A done row while amounts are hidden | "Done · 34%" uses the same share as the open row's bar: whole percent rounded down, at most 100, so an overspent done wish reads "Done · 100%". A done row's bar is muted, as in `HomeWishes.dc.html`. | 54 |
| O20 | The card headers' accessible names | Each header is one link holding the card's `h2` and the text at the right with the chevron; its name comes from that text ("Envelopes Day 5 of 31", "Wishes November"), with no `aria-label`. | 55 |
| O21 | "Add a wish" from Home | It opens `/wishes/new?month=<current month>`. `wishes.open` leaves `/api/home`: nothing shows it once the count goes. Back and saving use the history (UI-NAV-2), so they return to Home. The "<name> added to <month>." message is left for Wishes only when the form goes back to Wishes; from Home none is left, and Home shows no message for it, since the design draws none. A reload on the form falls back to Wishes, as UI-NAV-2 allows. | 55 |
| O22 | "Change month" (UI-WSH-4) | A hidden `<input type="month">` beside the button, as `WishDetail.html` draws it: `min` the current month, `max` 12 months later, value the wish's month, opened with `showPicker()` and, if that throws, focus and click, as the prototype does. A picked month outside the range takes the nearest allowed one, as the wish form's Month field does, since the iPhone may not hold to `min` and `max`. An empty value or the wish's own month changes nothing. The message always names the year: "Moved to February 2027.", "Moved to December 2026.". An open wish of a past month shows the button too, preset to its own month. | 56 |

## Out of scope

- Split expenses. Spec 02 has one part per transaction. TXN-9, when it comes, decides how a split expense counts for a wish (the whole expense for one wish, or a choice per part); the link table in Design 1 belongs to the transaction, and TXN-9 would add a nullable `part_id` column to it, not a table.
- Free money, the expected change after wishes, and a wish's place in the month plan (spec 3c); the plan's "Confirm plan" and recorded plans.
- Due payments, recurring transactions and matches by the app (spec 3b). Design 1 says where they fit.
- Reordering wishes, a wish that repeats, and copying wishes to the next month (PLN-11: not copied by themselves).
- A list of past changes to a wish. Who made the wish and who last changed it, with the times (MEM-5), is stored; a revision history of wishes is not.
- Notifications for wishes (NTF-5 mentions the start of a new month in spec 3c).

## Design

### 1. Data model (migration 0006)

Conventions of spec 1 Design 4 and spec 02 Design 2 hold: `id INTEGER PRIMARY KEY`, foreign keys on, amounts as `INTEGER` minor units read as `bigint`, `*_by` columns reference `member.id`, constraints in the schema, months `YYYY-MM` and dates `YYYY-MM-DD` in the family time zone. The migration is `server/drizzle/0006_wishes.sql`, made with `drizzle-kit` from `server/src/db/schema.ts` (no hand-written SQL); `/api/health` reports `migrationVersion` 7 after it (the number of files), and the counts in `smoke` and `foundation-integration` move from 6 to 7.

| Table | Columns | Constraints and notes |
|---|---|---|
| `wish` | `month`, `name`, `amount`, `expression` (nullable), `currency`, `category_id` (nullable), `note` (nullable), `state` (`open`/`done`/`dropped`, default `open`), `created_by`, `created_at`, `updated_by`, `updated_at`, `deleted_at` (nullable), `deleted_by` (nullable) | Follows `envelope`: `currency` is an ISO code or a coin, validated in the service. `CHECK`: `month` matches the month pattern, `amount > 0`, `state` is one of the three, `deleted_at` and `deleted_by` are both null or both set. `category_id` references `category`, and the category is never deleted while a wish uses it, as for parts. Indexes: `(month)` where `deleted_at IS NULL`, `(category_id)` where not null. `updated_*` change on every edit and on every state or month change (MEM-5). Delete is soft (`deleted_at`), for Undo. |
| `plan_link` | `txn_id` (ON DELETE CASCADE), `kind` (`wish`), `wish_id` (nullable), `month`, `amount` (nullable), `amount_manual` (0/1), `made_how` (`recorded`/`member`), `made_by` (nullable), `made_at`, `detached_at` (nullable), `detached_reason` (nullable) | One table of links from a transaction to a plan item. `kind = 'wish'` now. `wish_id` references `wish`. `CHECK`: `kind IN ('wish')`, `made_how IN ('recorded', 'member')`, `detached_reason IS NULL OR detached_reason IN ('wish_deleted')`, `wish_id IS NOT NULL` when `kind = 'wish'`, `amount_manual IN (0, 1)`, `amount_manual = 0 OR amount IS NOT NULL`; `detached_at` and `detached_reason` both null or both set. `month` is the month of the expense's date, kept in step with it. `amount` is in the wish's currency (Design 3); null means its rate is missing, as `txn_part.envelope_amount`. `made_by` is the member, null only for a link made by the app (spec 3b). Indexes: unique `(txn_id)` where `detached_at IS NULL` (one active link per transaction), `(wish_id)` where `detached_at IS NULL`, `(month)` where `detached_at IS NULL`. `detached_reason` is `wish_deleted` in this spec. |

"One choice" (PLN-14) is kept by the service, inside one database transaction, and by the unique active index on `txn_id`. There are no triggers: `drizzle-kit` cannot write them, and a SQLite table rebuild (which 3b's migration needs) fails or silently drops a trigger that reads another table. Tests cover every path that sets an envelope or a link (Design 2).

**Why envelopes stay on `txn_part`.** An envelope charge is per part, with its own converted amount, and spec 02 and the envelope balances already read it there. Moving it would rewrite spec 02 for no gain in 3a. With one part per transaction (D1) the part's `envelope_id` and the transaction's active link are the two halves of one choice. If TXN-9 ever allows several parts, the choice becomes per part: `plan_link` gets a nullable `part_id` and the unique index moves to it.

**What spec 3b adds, with a migration and no new table.** A due payment is a link of another kind, with the columns it needs:

- `kind` gains `due_payment`, and `made_how` gains `app`; `made_by` is null for those. SQLite cannot widen a `CHECK` in place, so the migration is the table rebuild `drizzle-kit` writes for it, copying the rows.
- New nullable columns identify the payment: `recurring_id` (references the recurring transaction) and `due_date` (the schedule date), with `CHECK`s that `wish_id` is set exactly for `kind = 'wish'`, and `recurring_id` and `due_date` exactly for `kind = 'due_payment'`. The unique active index on `txn_id` already makes a transaction count for one thing; a second unique index on `(recurring_id, due_date)` where active and not null makes a due payment count for one transaction (requirements 4.7: "nothing counts for yet").
- `plan_link.amount` for a due payment is in the recurring transaction's currency, with the same manual flag and rules.
- `txn_revision.changed_by` is `NOT NULL`; the app's matches are logged as the app, so 3b's migration rebuilds `txn_revision` with it nullable. Spec 3b also needs links for incomes, which this spec refuses (O1).
- "Never match this transaction to this payment again" (requirements 4.7): undoing a match or moving the transaction does not delete the row; it sets `detached_at` and `detached_reason = 'undone'`. The matcher skips a pair that has such a row. Rows with that reason are ignored by every reader that reads active links.

### 2. Rules: what counts where

- A confirmed expense counts in one place, tried in this order (requirements 4.7): the envelope of its part, else its active link, else unplanned spending. A draft, a transfer and an income count for no wish.
- A link is made only for an expense that has no envelope and no active link, by:
  - **recorded**: "Add expense" on the wish (PLN-18, owner 2026-11-15), whose `POST /api/transactions` call creates the expense and its link in one database transaction;
  - **member**: choosing the wish on the transaction's page, or linking from the wish (PLN-10).
- A new link needs `txn.date` in the wish's month and the wish not dropped or deleted. A done wish may be linked (a late receipt); the design allows it, because "Counts for" lists the month's wishes.
- Choosing a wish on the transaction page for an expense charged to an envelope clears the part's `envelope_id`, `envelope_amount` and `envelope_amount_manual` and makes the link in the same call. One revision logs both (Design 6).
- Choosing an envelope for a linked expense deletes the link row and sets the envelope in the same call. Choosing "Neither" deletes the link and clears the envelope. A date change into another month deletes the link (O3). Deleting the transaction deletes its link with it (cascade) and the delete revision records the link (Design 6).
- Deleting a wish detaches its links (`detached_at` = the wish's `deleted_at`, `detached_reason = 'wish_deleted'`); the expenses count as unplanned and each gets a revision "Link to <wish> removed". Restoring the wish reattaches the links whose expense is still a confirmed expense dated in `link.month`, unlinked and without an envelope, and logs "Linked to the wish <wish>" on each. A link that cannot be reattached stays detached; the answer lists those transaction ids so the screen can say so.
- A change of month changes `wish.month`; its links stay (O4). Any wish that is not deleted, open, done or dropped, can move to any other month in the O8 range, earlier or later (PLN-11), from its edit page (`PATCH`) or by `/move`. The wish page's "Change month" button (UI-WSH-4, Design 10) and its Undo use `/move`; it shows on every open wish, and its picker offers the current month to a year ahead (O22). The server stores no origin month, so Undo is a move back.
- Tick off and reopen change `state`. Drop sets `dropped`, bring back sets `open`. A done or dropped wish keeps its links. A dropped wish is left out of the month's total and cannot be linked or have an expense added.
- Any member can add, change, tick off, drop, delete, link and unlink (MEM-4). `created_*` and `updated_*` say who and when (MEM-5).

### 3. Money

- **Link amount (D2).** For an expense with account currency A and a wish in currency W: if A = W, `plan_link.amount` equals `txn.amount` (negative for a refund). Otherwise it is `convert(txn.amount, A → W)` at the rate of `txn.date` (or the nearest earlier date), rounded once with `roundHalfAwayFromZero`, and stored. Later rate changes do not change it. With no rate it stays null; `fillPendingLinkAmounts()` fills it after the rates service stores new rates and at start, as `fillPendingEnvelopeAmounts()` does. A member can type it by hand (`amount_manual = 1`). A later change of the expense's amount, date or account, or of the wish, recomputes it and clears the flag. Relabelling an account's currency (ACC-5) recomputes the non-manual link amounts of its transactions with the rest of spec 02 3.3. Changing a wish's currency recomputes all its links (O5).
- **Rates for wish currencies.** The rates service (`server/src/rates/service.ts`: `selectUsed`, `selectEarliestTransactions`) gathers the currencies of accounts and envelopes. It is extended to `wish.currency` and to the dates of the links' expenses in it, so that a wish in a currency no account uses still gets rates and `fillPendingLinkAmounts()` can fill its amounts (spec 02 3.11).
- **Recording a wish (as changed on 2026-11-15, TASK-50).** The Add form opened from the wish shows the amount in the paying account's currency, converted at the day's rate, and the account is picked in advance as on Add elsewhere. The untouched converted prefill sends `linkAmount`, the wish's own figure (what is left of the wish), and the server stores it as the link amount with `amount_manual = 0`; an edited amount or date, or no `linkAmount`, makes the server convert the expense's amount and date as usual. In the wish's own currency the link amount is the expense's amount. With no rate between the account's currency and the wish's, the form shows "Rate missing", leaves the amount empty and the server saves the link with a null amount, filled later.
- **Spent** on a wish is the sum of `plan_link.amount` of its active links, refunds subtracting. A link with a null amount is left out and the wish is marked `incomplete`, never guessed. **Left** = amount − spent; **over** is spent − amount when positive. A done wish shows what was spent and **under** = amount − spent when positive (UI-WSH-2). These are the formulas of an envelope that is spent once: there is no top-up, carry-over or adjustment.
- **The month's total** is the sum of the amounts of the month's wishes that are not dropped and not deleted. Per currency in its own unit first, then each currency total converted to the common currency at the rate of the month's first day or the nearest earlier date (requirements 4.2; the latest stored rate, marked estimated, for a month that has not started), rounded once per currency, then added (money-rules). A missing rate marks the total `incomplete`, and the screen shows "Rate missing" as spec 02 does.
- Amounts travel as decimal-integer strings; the screens show them with the currency's decimals. Nothing here uses floating point.

### 4. API

Every route follows spec 1 Design 7 (session with a profile, zod schemas in `shared/src/api/wishes.ts` and `transactions.ts`, the error shape, CSRF on writes). No wish route is allowed from a locked session; spec 02's one exception (`POST /api/transactions`) stands (PLN-21). Writes need a connection: there is no outbox for wishes.

| Route | Purpose | Refs |
|---|---|---|
| `GET /api/wishes?month=` | One month's wishes in the order of O12, each with `spent`, `left`, `over`, `under`, `incomplete`, `expenseCount` and `expenses`; plus `counts { total, open }` and `total` (the amount of the wishes that are not dropped, in the common currency, with `incomplete`). Default month: the current one. | PLN-9, UI-WSH-1, UI-WSH-2 |
| `GET /api/add-options` (spec 2) | Gains `wishes`: the open wishes of the family's current month, in the order of the Wishes screen, each `{ id, name, month, currency, amount, spent }`, so the Add form offers them as "Counts for" chips and keeps them for offline use. The only amounts the options carry. For another month the form asks `GET /api/wishes?month=` online and offers none offline. | UI-ADD-17 |
| `GET /api/wishes/:id` | One wish with its linked expenses: transaction id, merchant, note, date, account, amount and currency, `linkAmount`, `madeHow` and `madeBy` ("recorded from the wish", "linked by Alena"). | UI-WSH-4 |
| `POST /api/wishes`, `PATCH /api/wishes/:id` | Add; change name, amount and `expression`, currency, category, note, `month` (O8 range, same rule as `/move`) and `state` (tick off, reopen, drop, bring back). `PATCH` takes an optional `expect: { state?, month? }`; if the wish no longer has it, 409 `changed`. | PLN-9, PLN-16, MEM-5 |
| `POST /api/wishes/:id/move` | `{ month, expect }`: moves any wish that is not deleted to another month in the O8 range. 400 `invalid` for its own month or a month out of range. | PLN-11 |
| `DELETE /api/wishes/:id`, `POST /api/wishes/:id/restore` | Soft delete with its links detached; restore with its links, answering `{ wish, notRestored: [txnId] }`. | UI-WSH-3 |
| `POST /api/transactions` with `wishId` (and `linkAmount`) | Add expense from a wish: the Add call gains optional `wishId` and `linkAmount` (400 with an envelope, with another kind than expense, or `linkAmount` alone). It creates the expense (confirmed, no envelope, the category's default envelope not filled), the link (`member` by default, `recorded` with `wishFrom: 'wish'`, which the form sends when it was opened from that wish; a wish picked on the form is `member`, UI-ADD-17) and its revision in one database transaction, with the checks of any link: the wish exists and is not dropped or deleted, and the date is in its month, else 409 `wish_not_open`. The wish's state never changes. Idempotent by `clientId`. Replaces `POST /api/wishes/:id/record` and `…/unrecord`, which are removed. | PLN-18, UI-WSH-5 |
| `POST /api/transactions` with `unplanned: true` | "Neither" on the Add form (UI-ADD-17): the expense has no envelope and no link, and the category's default envelope is not filled (`filled` has no `envelope`). 400 with an `envelopeId`, a `wishId` or another kind than expense; `wishFrom` alone is a 400 too. | PLN-14, UI-ADD-17 |
| `GET /api/wishes/:id/candidates?q=` | The month's unplanned confirmed expenses, with a `fits` flag (O2); `q` splits on white space and matches merchant, note or amount, as in spec 02 section 5. None charged to an envelope, linked, a transfer or from another month. | UI-WSH-6 |
| `POST /api/wishes/:id/links` | `{ transactionId }`: link from the wish (`member`); 409 if the expense is no longer unplanned. | PLN-10 |
| `GET /api/envelopes/:id/candidates?q=` | The same list for an envelope (O15): the current month's unplanned confirmed expenses with a `fits` flag; same `q`. 404 for an unknown envelope. | UI-ENV-3 |
| `POST /api/envelopes/:id/links` | `{ transactionId }`: sets the expense's envelope as `PATCH /api/transactions/:id` does (converted amount, history line by the member) and answers 201 with the envelope detail. 409 `changed` if the expense is gone, planned meanwhile or of another month, or the envelope is archived; 404; 400. | UI-ENV-3 |
| `PATCH /api/transactions/:id` (extended) | Gains `wishId` (null for neither) beside `envelopeId`; sending both as non-null is 400 `invalid`. Gains `linkAmount`, set by hand like `envelopeAmount`. A date or amount change applies Design 2 and 3. | PLN-14, UI-TXN-10 |
| `GET /api/transactions/:id` (extended) | Gains `countsFor: { type: 'envelope' \| 'wish' \| 'none', id?, name?, linkAmount?, linkAmountManual?, linkCurrency?, madeHow?, madeBy?, rate? }`, so the row and the sheet read one object. The sheet's wishes come from `GET /api/wishes?month=`. | PLN-14 |
| `GET /api/home` (extended) | Adds `wishes`: the Wishes card of the current month, with the totals of the Wishes summary and one item per open or done wish with its `state` (TASK-53, then O16 and O21). | UI-HOME-10 |

Errors use spec 1's codes: 400 `invalid`, 404 `not_found`, 409 `changed` (above) and 409 `wish_not_open` when a dropped or deleted wish is linked to. The route-table test lists every route above: 401 without a session, `session_locked` from a locked session, CSRF refused without the header.

### 5. Undo

Tick off, reopen, move, drop, bring back and delete "act at once and offer Undo" (UI-WSH-3, UI-WSH-4). Adding an expense for a wish is the Add form's: its saved screen has Undo, which deletes the expense (UI-WSH-5). Undo is the inverse call, made by the screen with what it learned from the first answer, for the length of the message (about 8 seconds, as other Undo messages). The server keeps nothing for it except a deleted wish's rows (O6).

| Action | Call | Undo call | What the server keeps |
|---|---|---|---|
| Tick off | `PATCH` `state: done` | `PATCH` `state:` the previous state, `expect: { state: 'done' }` | nothing |
| Reopen | `PATCH` `state: open` | `PATCH` `state:` the previous one (done or dropped), `expect: { state: 'open' }` | nothing |
| Drop | `PATCH` `state: dropped`, `expect: { state: 'open' }` | `PATCH` `state:` the previous one, `expect: { state: 'dropped' }` | nothing |
| Bring back | `PATCH` `state: open`, `expect: { state: 'dropped' }` | `PATCH` `state: dropped`, `expect: { state: 'open' }` | nothing |
| Move | `POST …/move` to the month picked with "Change month" (or any other month) | `POST …/move` to the old month, `expect: { month: new }` | links stay on the wish (O4) |
| Delete | `DELETE` | `POST …/restore` | the wish marked deleted, its links detached with the same time and `wish_deleted`; a revision on each expense |

Delete and restore of a wish with links are built in two steps: TASK-38 the wish itself, TASK-41 the detaching and reattaching of links with their revisions. Link from the wish and the "Counts for" sheet offer no Undo in the design; the member undoes them by choosing again, and the history shows both steps. A 409 `changed` from an Undo call makes the screen say "Someone changed it meanwhile." (no new design; the existing toast).

### 6. History (MEM-5, UI-TXN-7)

Every change of what a transaction counts for is one `txn_revision` row, `action: 'update'`, `changed_by` the member, written in the same database transaction as the change. `transactionChangesSchema` (`shared/src/api/transactions.ts`) gains these keys, each a `[old, new]` pair as the others:

- `link`: `null` or `{ kind: 'wish', wishId, name, madeHow }`. The name is a snapshot, so the Record section can render the line after the wish is renamed or deleted. Spec 3b adds `kind: 'due_payment'` with its fields.
- `linkAmount` (minor-unit string, in the wish's currency) and `linkAmountManual` (boolean), for a link made or corrected. A revision that only corrects an amount (or recomputes it after a currency change) also holds `linkWish: { wishId, name }`, a single value and not a pair, so the line can name the wish after a rename or delete.
- `envelopeId` and `envelopeAmount` already exist.

Lines (UI-TXN-10, O9) the Record section builds from one revision, each followed by "by <member>":

| Revision | Line |
|---|---|
| `link: [null, W]`, `madeHow: member` | Linked to the wish W |
| `link: [null, W]`, `madeHow: recorded` (the revision that creates the expense; a reattach on restore carries `madeHow: member`) | Recorded from the wish W |
| `link: [null, W]` with `envelopeId: [E, null]` | Moved from the E envelope to the wish W |
| `link: [W, null]` with `envelopeId: [null, E]` | Charged to E; link to W removed |
| `link: [W, null]`, no envelope change (including a date out of the month and a deleted wish) | Link to W removed |
| `link: [W1, W2]` | Moved from the wish W1 to the wish W2 |
| `linkAmount: [a, b]` with `linkWish: W` | Counts for W as €b |

A transaction deleted while linked writes the delete revision with `link: [W, null]` among its old values, so its record still says what it counted for. The envelope in a line is today's name (envelopes are never deleted while used); the wish is the snapshot name unless the wish still exists, when its current name is shown.

### 7. Export (PLN-17)

`server/src/export/files.ts` gains two CSV files in the style of the others, with amounts in the currency's units and a currency column (SEC-6: only listed columns are read):

- `wishes.csv`: `id`, `month`, `name`, `amount`, `currency`, `category` (name), `note`, `expression`, `state`, `created_by`, `created_at`, `updated_by`, `updated_at`. Deleted wishes are left out.
- `wish_links.csv`: `transaction_id`, `wish_id`, `month`, `amount` (in the wish's currency), `amount_manual`, `made_how`, `made_by`, `made_at`. Detached links are left out.

The archive has no format version today (`server/src/export/archive.ts`), so none changes. The `transaction_revisions.csv` file already carries `changes` as JSON, so the new keys of Design 6 are exported with it. Backups copy the whole database and need no change; a test restores one into a fresh database and finds wishes, links and deleted ones intact. The export test that fails on an unlisted table or column covers `wish` and `plan_link`.

### 8. Screens

The screens are in the design; this spec only points to them and settles what they read.

- **Home** (UI-HOME-10, replacing UI-HOME-9): the Wishes card of the month carousel (TASK-53), with ticks, header links and "Add a wish" from Design 10.
- **Wishes** (UI-WSH-1, UI-WSH-2): `GET /api/wishes?month=`; the footnote and empty month as drawn; the summary line from `counts` and `total`.
- **New and edit wish** (UI-WSH-3): full pages like the envelope form; the expression field (O11); the delete hint "It has expenses…" uses `expenseCount`.
- **A wish's page** (UI-WSH-4): `GET /api/wishes/:id`; "Change month" for any open wish (Design 10); "Spent on it" says how each expense was linked and shows "counts as €21.40" for an expense in another currency (design change of 2026-11-13).
- **Add expense** (UI-WSH-5, UI-ADD-16): the bar opens `/add?wishId=<id>`; the Add form loads the wish, prefills it, picks it by hand (it leads the "Counts for" chips and can be changed, UI-ADD-17) and saves with `wishId` and `wishFrom: 'wish'`. **Link an expense** (UI-WSH-6): the calls of Design 4; the search sheet is the candidates route.
- **Transaction page** (UI-TXN-4, UI-TXN-10): the "Counts for" row and sheet read `countsFor` and the month's wishes; the row of a wish in another currency reads "Winter tyres · counts as €21.40" and the sheet adds "Counts for the wish as" with the keypad and the rate used (D2), `TransactionFx` being the pattern; Record lines come from Design 6.
- **Delete** of a linked expense says "It no longer counts for <wish>. This can't be undone." (UI-TXN-10).

### 9. Offline (PLN-21, UI-WSH-7)

Wishes, a wish's page and the forms are not reachable offline, like every screen but the Add form; the service worker never caches `/api/wishes`. Add expense, link, tick off, move, drop, delete and edit are disabled when the connection drops while a page is open, with the line of UI-WSH-7. Limited Home has no carousel. On a Home that is loaded but offline, the Wishes card's ticks are disabled (Design 10). The Add form opened from a wish disables Save offline ("Save · needs a connection", PLN-21). An item whose Save was lost on the way keeps its `wishId` in the outbox; the server checks it on arrival and a refusal becomes a failed item. An expense saved offline from the plain form has no link.

### 10. Wishes from Home, and Change month (2026-11-18)

Design PR #108, decided by the owner: UI-HOME-10, UI-NAV-2 and UI-WSH-4 in `docs/design-spec.md`, the row "Wishes from Home, and Change month (2026-11-18)" of its decisions table, and PLN-10 and PLN-11 as amended that day. Prototypes `Main`, `HomeWishes`, `HomeWaiting`, `WishDetail` and `WishesNew` in `docs/design/prototype/`; static screens `Main`, `HomeWishes` and `WishDetail` in `docs/design/html/screens/`, whose HTML gives structure, spacing and copy.

**Goal.** A member ticks a wish off as done, or reopens it, straight from Home's Wishes card, which now lists the month's done wishes beside the open ones. Each carousel card's header opens its screen, and the card's last row adds a wish and comes back to Home. On a wish's page, "Change month" moves any open wish to a month picked with the iPhone's month picker, from the current month to a year ahead.

**Out of scope.** Ticking or dropping from the Wishes screen; dropping, deleting or moving a wish from Home; ticks that wait in the outbox while offline (PLN-21: they need a connection); Limited Home (UI-HOME-7), which still has no carousel; the Envelopes card's rows; a new server route or migration. The design is decided and not reopened here.

**Home's Wishes card** (TASK-54, TASK-55). Files: `server/src/domain/home.ts`, `shared/src/api/home.ts`, `web/src/screens/home/wishesCard.ts`, `web/src/screens/home/HomeScreen.vue`, `web/src/screens/wishes/WishFormScreen.vue`.

- Data: O16. The card adds no request: the tick uses `PATCH /api/wishes/:id`, which already takes `state` and `expect.state` (Design 4, 5) and answers with the wish.
- Rows: a round tick at the left replaces the star, with the name, the meta and the bar to its right. The tick is a `button` with a 44 by 44 target, `aria-pressed`, and the name "Tick off <name> as done" or "Reopen <name>". The rest of the row is the link to `/wishes/:id`, whose Back returns to Home (UI-NAV-2, as built by TASK-53).
- A done row: the tick filled in the accent color with a check, the name struck through and muted, the meta "Done · €120.00", hidden "Done · 34%" (O19), nothing spent "Done".
- Ticking acts at once (O18): a toast above "Add expense" says "<name> ticked off." or "<name> reopened." with Undo. The row keeps its place (O17).
- Offline (PLN-21): on a loaded Home whose connection drops, the ticks are disabled; rows and links stay.
- Headers: each card's header becomes a link with a chevron at the right and a 44-point-high target: the Envelopes header opens `/envelopes`, the Wishes header opens `/wishes` (O20).
- Last row: "2 open this month · see all wishes" and "Plan a wish" go, with `wishes.open` (O21). In their place "Add a wish", in the accent color with a plus, opens the new wish form for the current month. With no wishes the card reads "No wishes this month" above "Add a wish". The form's Back says "Back to home", and saving returns to Home, which loads again and shows the new wish. `WishFormScreen.vue` already calls `goBack()` after saving; the task checks it in E2E rather than assuming it.

**A wish's page** (TASK-56). Files: `web/src/screens/wishes/WishScreen.vue`, `web/src/screens/wishes/wishesFormat.ts` (`clampMonth` gains a lower bound, the current month here), and the `WishMonthStepper.vue` input pattern, reused rather than copied where it fits.

- "Move to <next month>" becomes "Change month" with the calendar icon (`aria-haspopup="dialog"`), for every open wish, whatever its month (O22). Done and dropped wishes show only "Reopen", as now.
- Picking another month calls `POST /api/wishes/:id/move` with `{ month, expect: { month: old } }` and says "Moved to February 2027." with Undo, the move back that the page already makes. Picking the wish's own month, or dismissing the picker, makes no call and shows nothing. Offline the button is disabled, like the page's other actions.
- Server: nothing changes. `/move` already accepts any month from 2000-01 to 12 months ahead, and `server/test/wishes-integration.test.ts` ("moves a wish to any other month in range, and back for Undo", "stamps the member and time on a move, and 409s on a stale month or state") already covers a later and an earlier month, the last month in range, a month past it, the wish's own month (400) and a stale `expect` (409). The task only adds a case if it finds one of these missing.

**Verification** for this section, beyond the commands in Verification:

- Unit: `web/test/home-wishes-card.test.ts` for open and done rows, revealed and hidden, nothing spent, overspent and the empty card; server tests for `wishes.items` on `/api/home` (open and done in O12 order, no dropped or deleted wish, `state` on each, totals unchanged by a tick); `web/test/wishes-format.test.ts` for the lower bound of `clampMonth`.
- E2E on WebKit at iPhone size (390 × 844), as the `webkit-e2e` skill runs them: tick and Undo on Home, reopen, the place kept until Home opens again, ticks disabled offline; the two header links; "Add a wish" with "Back to home" and with saving back to Home, the new wish on the card, and the empty card; "Change month" with its message and Undo, the own month making no call, and the button on a wish of a coming month. The native picker cannot be opened by Playwright, so the tests set the input's value and fire `change`.
- Screenshots at iPhone size in `test-results/screens/` for design review: `Main.png` and `HomeWishes.png` (one wish ticked, one open) by TASK-54 and again by TASK-55, and `WishDetail.png` by TASK-56, each compared with the static screen of the same name.

## Tasks

On the board with the label `spec-03a`, TASK-38 to TASK-47. Each task meets the definition of done in `AGENTS.md`; "E2E" means a Playwright test in `web/e2e/` on WebKit at iPhone and iPad sizes (read the `webkit-e2e` skill first). The split of the board is kept; no task is created or archived.

1. **TASK-38 Wishes on the server.** Design 1 (both tables, the migration), 2 (the wish's own rules), 3 (spent, left, total), 4 (`/api/wishes` list, one, add, change, move, delete, restore; `wishes` on `/api/home`), 5. The link table is created here, with no link made yet, so deleting and restoring a wish moves only the wish until TASK-41 adds the links' part. Files: `server/src/db/schema.ts`, `server/drizzle/`, `server/src/modules/wishes/`, `server/src/domain/home.ts`, `server/src/app.ts`, `shared/src/api/wishes.ts`, `shared/src/api/home.ts`, `docs/requirements.md` (4.2 rule 3, O14), tests. Depends: this spec (TASK-37).
2. **TASK-39 Wishes screen and Home's Wishes row.** Design 8 (Home, Wishes), 9. Depends: 38.
3. **TASK-40 A wish's page.** Design 8 (a wish's page), 5 (tick off, reopen, move), 9. Depends: 39. Its E2E seeds links directly in the database, since links come from 41 and 42.
4. **TASK-41 Links on the server.** Design 1 (link rules), 2, 3 (stored converted amount, recompute, `fillPendingLinkAmounts`), 4 (`PATCH` and `GET /api/transactions/:id`), 6 (revisions), and in 5 the reattach of a deleted wish's links on restore. Files: `server/src/modules/transactions/`, `server/src/modules/envelopes/` (balances), `server/src/domain/transactions.ts`, `server/src/domain/envelopes.ts`, `server/src/modules/wishes/`, `shared/src/api/transactions.ts`, `server/src/rates/service.ts` (Design 3, rates for wish currencies), tests. Depends: 38.
5. **TASK-42 Record a wish as an expense.** Design 3 (recording), 4 (`record`, `unrecord`), 5, 6. Depends: 40, 41. Replaced by TASK-50 on 2026-11-15 (Add expense opens the Add form).
6. **TASK-43 Transaction page: the "Counts for" row and its sheet.** Design 8 (transaction page, delete), 6 (Record lines), including the "Counts for the wish as" correction. Depends: 40, 41.
7. **TASK-44 Link an expense to a wish from the wish.** Design 4 (`candidates`, `links`), O2. Depends: 40, 41.
8. **TASK-45 Export: wishes and their links.** Design 7. Depends: 41.
9. **TASK-47 New and edit wish: the form pages, drop and delete.** Design 8 (forms), 5 (drop, bring back, delete). Depends: 40, 41 (deleting a wish unlinks its expenses only once TASK-41 is built).
10. **TASK-46 Spec 3a acceptance and retiring the shared note.** Verification (the trial). Depends: 39, 40, 41, 42, 43, 44, 45, 47.
11. **TASK-51 Link an expense from an envelope's page.** The two envelope routes of Design 4, O15; the sheet is shared with TASK-44's. Tests: `envelope-links-integration.test.ts`, `routeTable.ts`, `web/e2e/envelope-link.spec.ts`.
12. **TASK-54 Home: tick a wish off or reopen it from the Wishes card.** Design 10 (Home's Wishes card: data, rows, done row, toast, place, offline), O16 to O19. Depends: none (TASK-53 is merged).
13. **TASK-55 Home: card headers open their screens, and "Add a wish" ends the Wishes card.** Design 10 (headers, last row, the form from Home), O20, O21. Depends: 54, which changes the same card.
14. **TASK-56 A wish's page: "Change month" with the month picker.** Design 10 (a wish's page), O22. Depends: none.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
```

Spec 3a is done when each line of the roadmap's "Done when" holds, shown by the task and test named:

| Done when | Shown by |
|---|---|
| This month's wishes are in the app and the shared note is no longer used | TASK-39 and TASK-47 E2E; the trial of TASK-46 |
| An expense added from a wish, with the paying account picked in advance, shows as spent on it | TASK-42 and TASK-50 tests and E2E |
| An expense linked from its transaction page and one picked from the wish both count for the wish | TASK-41 test, TASK-43 and TASK-44 E2E |
| Choosing a wish for an expense charged to an envelope takes it out of the envelope and logs the change | TASK-41 test (balance and revision), TASK-43 E2E |
| An open wish moved to the next month shows there and no longer in its old month | TASK-38 test, TASK-40 E2E |
| An open wish moved with "Change month" to any month up to a year ahead shows there and no longer in its old month, and Undo brings it back | TASK-38 test, TASK-56 E2E |
| A wish ticked off and reopened from Home's Wishes card, with Undo, and a wish added from Home comes back to Home | TASK-54 and TASK-55 tests and E2E |
| A linked expense in another currency stores a converted amount that a member can correct (D2) | TASK-41 test, TASK-43 E2E |
| A migration made by the previous `main` runs through the server with 0006 (as spec 02 did for 0005) | TASK-38 test |

TASK-46 is a trial with the owner on prod and the family's phones: it records the date and result of each line in "Trial results" below.

## Trial results

(Filled in by TASK-46.)

## Change log

- 2026-11-13: written by a build session (TASK-37), with the owner's answers of the same day as D1 and D2; defaults O1 to O14 wait for the owner. `docs/design-spec.md` changes in the same pull request: UI-TXN-10 gains the "counts as" row and the "Counts for the wish as" keypad for a wish in another currency, following UI-TXN-5 (owner, 2026-11-13); UI-WSH-4 shows "counts as" under such an expense; section 18 lists the decision. The screens in `docs/design/html/screens/` are not redrawn. The board's spec-03a tasks were brought in line with the spec; none was created or archived.
- 2026-11-15: TASK-50 (owner): "Record as expense" is replaced by "Add expense", which opens the shared Add form with the wish (`?wishId=`). The link is made in `POST /api/transactions`; `/record` and `/unrecord` and the record sheet are removed; the account is picked in advance as on Add elsewhere (replacing the rule of 2026-10-18); the wish always stays open. Changes Design 3 (recording a wish), 4, 5, 8 and 9, O9, O13 and the verification line.
- 2026-11-17: TASK-52 (owner, design PR #105): the Add form's Envelope row becomes "Counts for" (UI-ADD-17): envelopes, the date's open wishes and "Unplanned", with the transaction page's sheet reused. `POST /api/transactions` gains `unplanned` and `wishFrom` (a wish picked on the form is a `member` link, one opened from the wish stays `recorded`), and `/api/add-options` gains `wishes`. Changes Design 4 and 8. The Add form no longer warns about a date outside the wish's month: the wish is cleared instead (UI-WSH-5 amended).
- 2026-11-18: design PR #108 (owner): Home's Wishes card lists the month's open and done wishes with a tick that ticks one off or reopens it, each carousel card's header opens its screen, and "Add a wish" replaces the count of open wishes; on a wish's page "Move to <next month>" becomes "Change month" with the month picker, for any open wish (PLN-10, PLN-11 amended). Adds Design 10, O16 to O22 and TASK-54 to TASK-56; updates the Goal, Design 2, 4, 5, 8 and 9 and O10, which TASK-53 had already replaced. No server route or migration changes.
