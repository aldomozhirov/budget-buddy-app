# Spec 03a: Wishes

Status: written by a build session on 2026-11-13 with the owner's answers of the same day (planning thread of TASK-37). Requirements PLN-9 to PLN-11 and PLN-18, and PLN-14, PLN-16, PLN-17 and PLN-21 for wishes, envelopes and unplanned spending, in `docs/requirements.md` (sections 4.7, 8 "Spec 3a" and 11); design UI-HOME-9, section 9a (UI-WSH-1 to UI-WSH-7) and UI-TXN-10 in `docs/design-spec.md`. The number follows the roadmap (spec 3a); it comes after specs 1 and 2 and before 3b (recurring transactions) and 3c (the month plan), which add to what it builds.

Inputs: `AGENTS.md`, `docs/requirements.md` (sections 4.7 and 11, PLN-9 to PLN-11, PLN-14, PLN-16 to PLN-18, PLN-21, MEM-4, MEM-5, DSH-5, BKP-3), `docs/design-spec.md` (UI-HOME-9, UI-WSH-1 to UI-WSH-7, UI-TXN-4, UI-TXN-5, UI-TXN-7, UI-TXN-10), `docs/design/html/screens/` (`HomeWishes`, `Wishes`, `WishesNew`, `WishesNext`, `WishDetail`, `WishRecord`, `WishLink`, `WishDone`, `TransactionWish`, `TransactionCountsFor`, `TransactionInEnvelope`, `TransactionFx`), `docs/specs/02-spending.md` (D5, Design 2 and 3.3, 3.5, 3.9, 5), `server/src/db/schema.ts` (`txn`, `txn_part`, `txn_revision`, `envelope` as built, migrations up to 0005) and the skill `money-rules`.

## Goal

The family keeps each month's wishes in the app, in place of the shared note. A member adds a wish for this month or a coming one, sees what was spent on it, ticks it off, drops it, or moves an open one to the next month. A wish becomes an expense in one step ("Record as expense", with the paying account picked), or collects expenses that a member links from the wish or from the transaction's own page, where "Counts for" is one choice among an envelope, a wish of the month and neither. Choosing a wish for an expense charged to an envelope takes it out of the envelope, and every such change is logged. Home has a Wishes row with the count of open wishes. Nothing here is recurring, planned or reviewed: those are specs 3b to 3e.

## Decisions taken with the owner for this spec

| # | Topic | Decision |
|---|---|---|
| D1 | Split expenses | Decided 2026-11-13. Not built (spec 02, D5: one `txn_part` per transaction, "Split" hidden), so this spec ignores them. A link to a wish belongs to the transaction; choosing a wish clears the envelope of its one part, and the removal is logged. TXN-9 (split), when it comes, must decide how a split expense counts for a wish (Out of scope). |
| D2 | Currencies | Decided 2026-11-13. Wishes work like envelopes. An expense in another currency than its wish counts for the wish at its amount converted at the rate of the transaction's date. The converted amount is stored in the wish's minor units with a typed-by-hand flag, and a member can correct it, as "Counts in the envelope as" works (UI-TXN-5, spec 02 section 3.3): recomputed on a change of amount, date, account or wish, which also clears the typed-by-hand flag (spec 02 3.3). Recording a wish (PLN-18) stores the amount the record sheet showed. The month's total on Wishes is converted to the common currency at the rate of the month's first day, or the latest stored rate for a coming month (requirements 4.7). |

## Defaults to confirm

Chosen by the planning session where the requirements and the design are silent. Use them unless the owner objects. "Needed by" names the build task (Tasks).

| # | Item | Default | Needed by |
|---|---|---|---|
| O1 | What can be linked | Only a confirmed expense, and a refund (negative expense), can be linked to a wish; an income, a transfer and a draft cannot. A refund counts as a negative amount (requirements 4.7). | 41 |
| O2 | "Fits the wish" (UI-WSH-6) | An expense fits when its category is the wish's category, or when its merchant (compared by `merchant_key`) is the merchant of an expense already linked to the wish. A wish without a category and without links has no "Fits" group; the sheet then shows only "Other expenses in <month>". | 44 |
| O3 | A linked expense whose date leaves the month | Its link is removed, whoever made it, and the removal is logged (requirements 4.7). The check compares the new date's month with the link's `month` (Design 1), not with the wish's, so the rule also holds for a wish that was moved. | 41 |
| O4 | Moving an open wish with expenses (PLN-11) | The wish and its links move together. Spent stays the sum of its links, so a half-spent wish is half-spent in the next month. Each link keeps the `month` of its expense, so the old month's figures still count it where the expense was made, and the month plan (spec 3c) can use `link.month` for "spent on wishes" and the wish's month for its amount. The "Counts for" sheet lists the wishes of the expense's month, so an expense linked to a wish that has since moved shows no check; the row still names the wish. A new link needs an expense of the wish's current month. This departs from requirements 4.7 ("a wish of its month") for the old links of a moved wish, which is why it is a default to confirm: the alternative is to remove the links on a move and let the old expenses count as unplanned. | 38 |
| O5 | Currency of a wish with expenses | A member may change it. Every link's amount is then recomputed (typed-by-hand flags cleared), and each change is logged on its transaction as a corrected amount (Design 6). The edit form is unchanged. | 38, 41 |
| O6 | Server-side Undo | There is none beyond the inverse call (Design 5). The screens offer Undo for the length of their short message; the server accepts the inverse call at any time as long as the thing it needs still has the state it expects, and answers 409 `changed` otherwise. A deleted wish and its links are kept (marked deleted) and never purged. | 38 |
| O7 | Names | A wish name is 1 to 80 characters after trimming and need not be unique, since the same wish can come back in another month. A note is at most 500 characters. A wish's category is an active expense category; an archived one stays on a wish that already has it. | 38 |
| O8 | Months allowed | From 2000-01 (as dates, spec 02 3.4) to 12 months after the current month. | 38 |
| O9 | Wording of the history lines the design has not drawn | "Moved from the wish <wish> to the wish <wish>" (a link moved between wishes), "Recorded from the wish <wish>" (an expense made by "Record as expense") and "Counts for <wish> as €21.40" (a corrected converted amount), each followed by "by <member>" like the four lines of UI-TXN-10. | 41, 43 |
| O10 | Home's open count (UI-HOME-9) | `GET /api/home` gains `wishes: { open: number }`, so Home stays one request and works with the data it already caches. Limited Home (offline) has no Wishes row. | 38, 39 |
| O11 | Expression (PLN-16) | The client evaluates it; the server stores it as typed and only checks that it is at most 120 characters of digits, spaces, `+ − - × ÷ * / ( ) . ,`. The server never evaluates it and does not require it to equal the amount (money-rules). | 38 |
| O12 | Order of wishes in a month | Open wishes by creation time, oldest first; done and dropped ones after them in the same order. A member cannot reorder wishes. | 38 |
| O13 | A link and the Add form | A transaction created on the Add form has no link. Neither a rule nor a category's default fills an envelope into a linked expense: filling happens on create only, and labelling from "Needs a category" (spec 02 O7) never fills an envelope into a transaction that has a link. | 41 |
| O14 | Requirements 4.2 rule 3 | The stored `plan_link.amount` is a second exception to "converted figures are never stored". Amend the rule to name wishes beside envelopes. | 38 |

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
  - **recorded**: "Record as expense" (PLN-18), which creates the expense and its link in one database transaction;
  - **member**: choosing the wish on the transaction's page, or linking from the wish (PLN-10).
- A new link needs `txn.date` in the wish's month and the wish not dropped or deleted. A done wish may be linked (a late receipt); the design allows it, because "Counts for" lists the month's wishes.
- Choosing a wish on the transaction page for an expense charged to an envelope clears the part's `envelope_id`, `envelope_amount` and `envelope_amount_manual` and makes the link in the same call. One revision logs both (Design 6).
- Choosing an envelope for a linked expense deletes the link row and sets the envelope in the same call. Choosing "Neither" deletes the link and clears the envelope. A date change into another month deletes the link (O3). Deleting the transaction deletes its link with it (cascade) and the delete revision records the link (Design 6).
- Deleting a wish detaches its links (`detached_at` = the wish's `deleted_at`, `detached_reason = 'wish_deleted'`); the expenses count as unplanned and each gets a revision "Link to <wish> removed". Restoring the wish reattaches the links whose expense is still a confirmed expense dated in `link.month`, unlinked and without an envelope, and logs "Linked to the wish <wish>" on each. A link that cannot be reattached stays detached; the answer lists those transaction ids so the screen can say so.
- Moving an open wish to the next month changes `wish.month`; its links stay (O4). Only an open wish of the current month can move forward (PLN-11, UI-WSH-4); the same call moves a wish of next month back to the current month, for Undo. The server stores no origin month, so any open wish of next month can be moved back; that is harmless. No other change of month exists.
- Tick off and reopen change `state`. Drop sets `dropped`, bring back sets `open`. A done or dropped wish keeps its links. A dropped wish is left out of the month's total and cannot be linked or recorded.
- Any member can add, change, tick off, drop, delete, link and unlink (MEM-4). `created_*` and `updated_*` say who and when (MEM-5).

### 3. Money

- **Link amount (D2).** For an expense with account currency A and a wish in currency W: if A = W, `plan_link.amount` equals `txn.amount` (negative for a refund). Otherwise it is `convert(txn.amount, A → W)` at the rate of `txn.date` (or the nearest earlier date), rounded once with `roundHalfAwayFromZero`, and stored. Later rate changes do not change it. With no rate it stays null; `fillPendingLinkAmounts()` fills it after the rates service stores new rates and at start, as `fillPendingEnvelopeAmounts()` does. A member can type it by hand (`amount_manual = 1`). A later change of the expense's amount, date or account, or of the wish, recomputes it and clears the flag. Relabelling an account's currency (ACC-5) recomputes the non-manual link amounts of its transactions with the rest of spec 02 3.3. Changing a wish's currency recomputes all its links (O5).
- **Rates for wish currencies.** The rates service (`server/src/rates/service.ts`: `selectUsed`, `selectEarliestTransactions`) gathers the currencies of accounts and envelopes. It is extended to `wish.currency` and to the dates of the links' expenses in it, so that a wish in a currency no account uses still gets rates and `fillPendingLinkAmounts()` can fill its amounts (spec 02 3.11).
- **Recording a wish.** The record sheet shows the amount in the paying account's currency, converted at the day's rate. Saving stores the expense with that amount, and the link with the wish's own amount as the sheet showed (what is left of the wish, or the wish's amount), and `amount_manual = 0`. If the member changed the sheet's amount, or its date, the link amount is converted from the new amount and date as usual. With no rate between the paying account's currency and the wish's, the sheet shows "Rate missing" and saves the link with a null amount, filled later.
- **Spent** on a wish is the sum of `plan_link.amount` of its active links, refunds subtracting. A link with a null amount is left out and the wish is marked `incomplete`, never guessed. **Left** = amount − spent; **over** is spent − amount when positive. A done wish shows what was spent and **under** = amount − spent when positive (UI-WSH-2). These are the formulas of an envelope that is spent once: there is no top-up, carry-over or adjustment.
- **The month's total** is the sum of the amounts of the month's wishes that are not dropped and not deleted. Per currency in its own unit first, then each currency total converted to the common currency at the rate of the month's first day or the nearest earlier date (requirements 4.2; the latest stored rate, marked estimated, for a month that has not started), rounded once per currency, then added (money-rules). A missing rate marks the total `incomplete`, and the screen shows "Rate missing" as spec 02 does.
- Amounts travel as decimal-integer strings; the screens show them with the currency's decimals. Nothing here uses floating point.

### 4. API

Every route follows spec 1 Design 7 (session with a profile, zod schemas in `shared/src/api/wishes.ts` and `transactions.ts`, the error shape, CSRF on writes). No wish route is allowed from a locked session; spec 02's one exception (`POST /api/transactions`) stands (PLN-21). Writes need a connection: there is no outbox for wishes.

| Route | Purpose | Refs |
|---|---|---|
| `GET /api/wishes?month=` | One month's wishes in the order of O12, each with `spent`, `left`, `over`, `under`, `incomplete`, `expenseCount` and `expenses`; plus `counts { total, open }` and `total` (the amount of the wishes that are not dropped, in the common currency, with `incomplete`). Default month: the current one. | PLN-9, UI-WSH-1, UI-WSH-2 |
| `GET /api/wishes/:id` | One wish with its linked expenses: transaction id, merchant, note, date, account, amount and currency, `linkAmount`, `madeHow` and `madeBy` ("recorded from the wish", "linked by Alena"). | UI-WSH-4 |
| `POST /api/wishes`, `PATCH /api/wishes/:id` | Add; change name, amount and `expression`, currency, category, note, and `state` (tick off, reopen, drop, bring back). `PATCH` takes an optional `expect: { state?, month? }`; if the wish no longer has it, 409 `changed`. | PLN-9, PLN-16, MEM-5 |
| `POST /api/wishes/:id/move` | `{ month, expect }`: forward to the next month for an open wish of the current month, or back to the current month for a wish that was moved. 400 `invalid` for any other move. | PLN-11 |
| `DELETE /api/wishes/:id`, `POST /api/wishes/:id/restore` | Soft delete with its links detached; restore with its links, answering `{ wish, notRestored: [txnId] }`. | UI-WSH-3 |
| `POST /api/wishes/:id/record` | Record as expense: `{ amount, accountId, merchant?, date, categoryId?, keepOpen, clientId }`. Creates the expense (confirmed, the wish's name as its note, no envelope, the category's default envelope not filled), the link (`recorded`) and its revision, and ticks the wish off unless `keepOpen`, in one database transaction. Answers `{ transaction, wish, previousState }`. Idempotent by `clientId`. | PLN-18, UI-WSH-5 |
| `POST /api/wishes/:id/unrecord` | Undo of record: `{ transactionId, state }` deletes that expense (with a delete revision) if it is still linked to this wish as `recorded`, and sets the wish back to `state`; otherwise 409 `changed`. | UI-WSH-5 |
| `GET /api/wishes/:id/candidates?q=` | The month's unplanned confirmed expenses, with a `fits` flag (O2); `q` splits on white space and matches merchant, note or amount, as in spec 02 section 5. None charged to an envelope, linked, a transfer or from another month. | UI-WSH-6 |
| `POST /api/wishes/:id/links` | `{ transactionId }`: link from the wish (`member`); 409 if the expense is no longer unplanned. | PLN-10 |
| `PATCH /api/transactions/:id` (extended) | Gains `wishId` (null for neither) beside `envelopeId`; sending both as non-null is 400 `invalid`. Gains `linkAmount`, set by hand like `envelopeAmount`. A date or amount change applies Design 2 and 3. | PLN-14, UI-TXN-10 |
| `GET /api/transactions/:id` (extended) | Gains `countsFor: { type: 'envelope' \| 'wish' \| 'none', id?, name?, linkAmount?, linkAmountManual?, linkCurrency?, madeHow?, madeBy?, rate? }`, so the row and the sheet read one object. The sheet's wishes come from `GET /api/wishes?month=`. | PLN-14 |
| `GET /api/home` (extended) | Adds `wishes: { open }`, the number of open wishes of the current month (O10). | UI-HOME-9 |

Errors use spec 1's codes: 400 `invalid`, 404 `not_found`, 409 `changed` (above) and 409 `wish_not_open` when a dropped or deleted wish is linked to. The route-table test lists every route above: 401 without a session, `session_locked` from a locked session, CSRF refused without the header.

### 5. Undo

Tick off, reopen, move, drop, bring back, delete and record "act at once and offer Undo" (UI-WSH-3 to UI-WSH-5). Undo is the inverse call, made by the screen with what it learned from the first answer, for the length of the message (about 8 seconds, as other Undo messages). The server keeps nothing for it except a deleted wish's rows (O6).

| Action | Call | Undo call | What the server keeps |
|---|---|---|---|
| Tick off | `PATCH` `state: done` | `PATCH` `state:` the previous state, `expect: { state: 'done' }` | nothing |
| Reopen | `PATCH` `state: open` | `PATCH` `state:` the previous one (done or dropped), `expect: { state: 'open' }` | nothing |
| Drop | `PATCH` `state: dropped`, `expect: { state: 'open' }` | `PATCH` `state:` the previous one, `expect: { state: 'dropped' }` | nothing |
| Bring back | `PATCH` `state: open`, `expect: { state: 'dropped' }` | `PATCH` `state: dropped`, `expect: { state: 'open' }` | nothing |
| Move | `POST …/move` to the next month | `POST …/move` to the old month, `expect: { month: new }` | links stay on the wish (O4) |
| Delete | `DELETE` | `POST …/restore` | the wish marked deleted, its links detached with the same time and `wish_deleted`; a revision on each expense |
| Record | `POST …/record` | `POST …/unrecord { transactionId, state: previousState }` | the expense's delete revision (it was created and removed, UI-TXN-7) |

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

- **Home** (UI-HOME-9): the row reads `wishes.open` from `/api/home` (O10): "2 open this month", or "No wishes this month" at 0. No amounts.
- **Wishes** (UI-WSH-1, UI-WSH-2): `GET /api/wishes?month=`; the footnote and empty month as drawn; the summary line from `counts` and `total`.
- **New and edit wish** (UI-WSH-3): full pages like the envelope form; the expression field (O11); the delete hint "It has expenses…" uses `expenseCount`.
- **A wish's page** (UI-WSH-4): `GET /api/wishes/:id`; "Move to <month>" only for an open wish of the current month; "Spent on it" says how each expense was linked and shows "counts as €21.40" for an expense in another currency (design change of 2026-11-13).
- **Record as expense** (UI-WSH-5), **link an expense** (UI-WSH-6): the calls of Design 4; the search sheet is the candidates route.
- **Transaction page** (UI-TXN-4, UI-TXN-10): the "Counts for" row and sheet read `countsFor` and the month's wishes; the row of a wish in another currency reads "Winter tyres · counts as €21.40" and the sheet adds "Counts for the wish as" with the keypad and the rate used (D2), `TransactionFx` being the pattern; Record lines come from Design 6.
- **Delete** of a linked expense says "It no longer counts for <wish>. This can't be undone." (UI-TXN-10).

### 9. Offline (PLN-21, UI-WSH-7)

Wishes, a wish's page and the forms are not reachable offline, like every screen but the Add form; the service worker never caches `/api/wishes`. Record, link, tick off, move, drop, delete and edit are disabled when the connection drops while a page is open, with the line of UI-WSH-7. Limited Home has no Wishes row. An expense saved offline is created as always, with no link; nothing about wishes waits in the outbox.

## Tasks

On the board with the label `spec-03a`, TASK-38 to TASK-47. Each task meets the definition of done in `AGENTS.md`; "E2E" means a Playwright test in `web/e2e/` on WebKit at iPhone and iPad sizes (read the `webkit-e2e` skill first). The split of the board is kept; no task is created or archived.

1. **TASK-38 Wishes on the server.** Design 1 (both tables, the migration), 2 (the wish's own rules), 3 (spent, left, total), 4 (`/api/wishes` list, one, add, change, move, delete, restore; `wishes` on `/api/home`), 5. The link table is created here, with no link made yet, so deleting and restoring a wish moves only the wish until TASK-41 adds the links' part. Files: `server/src/db/schema.ts`, `server/drizzle/`, `server/src/modules/wishes/`, `server/src/domain/home.ts`, `server/src/app.ts`, `shared/src/api/wishes.ts`, `shared/src/api/home.ts`, `docs/requirements.md` (4.2 rule 3, O14), tests. Depends: this spec (TASK-37).
2. **TASK-39 Wishes screen and Home's Wishes row.** Design 8 (Home, Wishes), 9. Depends: 38.
3. **TASK-40 A wish's page.** Design 8 (a wish's page), 5 (tick off, reopen, move), 9. Depends: 39. Its E2E seeds links directly in the database, since links come from 41 and 42.
4. **TASK-41 Links on the server.** Design 1 (link rules), 2, 3 (stored converted amount, recompute, `fillPendingLinkAmounts`), 4 (`PATCH` and `GET /api/transactions/:id`), 6 (revisions), and in 5 the reattach of a deleted wish's links on restore. Files: `server/src/modules/transactions/`, `server/src/modules/envelopes/` (balances), `server/src/domain/transactions.ts`, `server/src/domain/envelopes.ts`, `server/src/modules/wishes/`, `shared/src/api/transactions.ts`, `server/src/rates/service.ts` (Design 3, rates for wish currencies), tests. Depends: 38.
5. **TASK-42 Record a wish as an expense.** Design 3 (recording), 4 (`record`, `unrecord`), 5, 6. Depends: 40, 41.
6. **TASK-43 Transaction page: the "Counts for" row and its sheet.** Design 8 (transaction page, delete), 6 (Record lines), including the "Counts for the wish as" correction. Depends: 40, 41.
7. **TASK-44 Link an expense to a wish from the wish.** Design 4 (`candidates`, `links`), O2. Depends: 40, 41.
8. **TASK-45 Export: wishes and their links.** Design 7. Depends: 41.
9. **TASK-47 New and edit wish: the form pages, drop and delete.** Design 8 (forms), 5 (drop, bring back, delete). Depends: 40, 41 (deleting a wish unlinks its expenses only once TASK-41 is built).
10. **TASK-46 Spec 3a acceptance and retiring the shared note.** Verification (the trial). Depends: 39, 40, 41, 42, 43, 44, 45, 47.

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
| A wish recorded as an expense, with the paying account picked, shows that expense as spent on it | TASK-42 test and E2E |
| An expense linked from its transaction page and one picked from the wish both count for the wish | TASK-41 test, TASK-43 and TASK-44 E2E |
| Choosing a wish for an expense charged to an envelope takes it out of the envelope and logs the change | TASK-41 test (balance and revision), TASK-43 E2E |
| An open wish moved to the next month shows there and no longer in its old month | TASK-38 test, TASK-40 E2E |
| A linked expense in another currency stores a converted amount that a member can correct (D2) | TASK-41 test, TASK-43 E2E |
| A migration made by the previous `main` runs through the server with 0006 (as spec 02 did for 0005) | TASK-38 test |

TASK-46 is a trial with the owner on prod and the family's phones: it records the date and result of each line in "Trial results" below.

## Trial results

(Filled in by TASK-46.)

## Change log

- 2026-11-13: written by a build session (TASK-37), with the owner's answers of the same day as D1 and D2; defaults O1 to O14 wait for the owner. `docs/design-spec.md` changes in the same pull request: UI-TXN-10 gains the "counts as" row and the "Counts for the wish as" keypad for a wish in another currency, following UI-TXN-5 (owner, 2026-11-13); UI-WSH-4 shows "counts as" under such an expense; section 18 lists the decision. The screens in `docs/design/html/screens/` are not redrawn. The board's spec-03a tasks were brought in line with the spec; none was created or archived.
