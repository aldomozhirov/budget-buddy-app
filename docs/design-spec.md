# Budget Buddy: design spec

Status: drafted on 2026-10-06 from the clickable prototype the owner reviewed. This document is the input for the `plan` and `build` agents whenever a task touches the user interface. It is not a spec in the sense of `AGENTS.md` and contains no task list.

## How to use this document

- `docs/requirements.md` says **what** the app does and owns the data rules. This document says **how it looks and behaves** on screen. When the two disagree, stop and ask the owner; do not pick one silently.
- Design rule IDs such as `UI-HOME-2` are stable. Cite them next to the requirement IDs in tasks and acceptance criteria.
- The prototype is the visual reference: layout, spacing, copy, states and flows. It is not production code. Its data is invented, and section 19 lists what to ignore in its files.
- Copy shown in quotes is the intended text. Keep it unless a task says otherwise.
- **Must**, **Should** and **Could** mean what they mean in the requirements.

Prototype: the Budget Buddy design canvas (private Claude artifact `https://claude.ai/artifact/JXe83ygWw5adVt42HE1x8d`). Each screen is one file named in section 2. A copy of every screen file, taken on 2026-10-06 and refreshed on 2026-10-14 with the screens of spec 2, is in `docs/design/prototype/`; its README says how to refresh it.

For building, use `docs/design/html/`: `bb.css` is the design system as one stylesheet (tokens, components, motion) and the canonical styling reference; `screens/` has every screen as static HTML and a PNG screenshot; `styleguide.html` is the style guide and component library for developers.

## 1. Principles

1. **Private in public.** The app is opened at supermarket tills and on the bus. Home shows no money figures until the member asks for them (UI-HOME-2).
2. **Type as little as possible.** Every form works with only the required field filled. Defaults, merchant rules and "Same" do the rest.
3. **One thumb.** The main action of a screen sits at the bottom within thumb reach. Every touch target is at least 44 points (IOS-5).
4. **Everything from Home.** Every feature is reachable from Home in at most two taps; the frequent ones in one.
5. **Optional means optional.** Category, envelope, merchant, note, date and payer can all be left alone. Nothing nags.
6. **Calm and plain.** One accent colour for progress and confirmation, one warning colour for overspending, staleness and errors, and nothing else that shouts.

## 2. Screen map

| Screen | Prototype file(s) | Purpose | Requirements | Reached from |
|---|---|---|---|---|
| Home | `Main.dc.html`; variants: `HomeWaiting.dc.html` (waiting to send, sign-out question), `HomeOffline.dc.html` and `HomeOfflineLocked.dc.html` (limited Home, UI-HOME-7) | Private overview and entry point | DSH-1, DSH-4, NTF-1, TXN-7 | App start |
| Add expense / income / transfer | `AddExpense.dc.html`; variants with search sheets open: `SearchAccounts.dc.html`, `SearchCategories.dc.html`; `AddTransferFx.dc.html` (transfer in two currencies) | Record a transaction | TXN-1 to TXN-4, TXN-7, CAT-5, ACC-9 | Home button and tiles, Transactions |
| Check-in | `CheckIn.dc.html` | Enter balances | CHK-5 to CHK-10 | Home banner and tile (while one is open), Check-ins, notification |
| Check-ins | `CheckIns.dc.html` | Open check-in and past ones | SUM-1, CHK-1 | Home |
| Check-in summary | `CheckInSummary.dc.html` | Result of one check-in | SUM-1 to SUM-6 | Home wealth card, Check-ins, Check-in closed screen, notification |
| Envelopes | `Envelopes.dc.html`; variants: `EnvelopesMove.dc.html` (move sheet), `EnvelopesHistory.dc.html` (history picker) | All envelopes this month | ENV-3 | Home envelopes card, Settings |
| Envelope | `EnvelopeDetail.dc.html`; variant: `EnvelopeCarryOver.dc.html` (carry-over envelope with a pending plan, adjustments and a move) | One envelope: month, history, move, adjust | ENV-3, ENV-5, ENV-6, ENV-9 | Envelopes |
| New and edit envelope | `EnvelopeNew.dc.html`, `EnvelopeEdit.dc.html` (drawn as sheets; pages since 2026-10-15) | Create, change, archive or delete an envelope | ENV-1, ENV-4, ENV-7 | Envelopes "+", the envelope page's cog |
| Archived envelopes | `ArchivedEnvelopes.dc.html` | Archived envelopes with Restore | ENV-1 | Envelopes |
| Transactions | `Transactions.dc.html`; variants: `ToLabel.dc.html` (Needs a category tab), `TransactionsFilter.dc.html` (filter sheet open), `TransactionsOutbox.dc.html` (items waiting to send) | List, search, filter, label | TXN-6, TXN-7, CAT-7 | Home |
| Transaction | `TransactionDetail.dc.html`; variant: `TransactionFx.dc.html` (expense in another currency) | View and edit one transaction | TXN-6, CAT-6, MEM-5 | Transactions, Envelope |
| Accounts | `Accounts.dc.html` | All accounts | ACC-3, DSH-3 | Home |
| Account | `AccountDetail.dc.html` | Balance history and settings | ACC-4 to ACC-8 | Accounts, Check-in summary, Transaction |
| New account | `NewAccount.dc.html` | Create an account | ACC-1, ACC-2, ACC-10 | Accounts, First start |
| Categories and rules | `Categories.dc.html`; variant: `Rules.dc.html` (Rules tab) | Manage categories and merchant rules | CAT-1, CAT-3, CAT-6, ENV-1 | Home, Settings |
| Settings | `Settings.dc.html`; variant: `SettingsSchedule.dc.html` (schedule sheet open) | Everything configurable | SET-1, SET-2, CHK-2, NTF-2, BKP-3, BKP-4 | Home |
| First start | `Setup.dc.html` | Family password and profiles | MEM-1 | No profile exists yet |
| Sign in | `SignIn.dc.html`; variants: `SignInPick.dc.html` (profile picker), `SignInLocked.dc.html` (too many tries) | Unlock the app on a device | MEM-2, MEM-6, SEC-2 | Signed-out device |

Not prototyped yet. Design them in the same system before building them:

- **Wealth history** (DSH-2, RPT-4). Until it exists, Home's "Wealth history" link opens the latest check-in summary, whose chart covers the need.
- **Reports** (RPT), **Reconciliation** (REC), **Inbox** (DRF), photo capture and confirmation (PHO), import and connector settings (IMP, APL, STM, CON).
- **Recurring transactions**: the Repeats choice on the Add form (with Repeats on, the date may be in the future and Envelope is hidden), "Repeat this" on a transaction's page, the recurring list and a recurring transaction's page (TXN-10, TXN-12 to TXN-14). Then the **month plan**, how a closed check-in leads to it (PLN-8), the "estimated" mark on a coming month's converted figures (PLN-2), and "Confirm plan" with the changes made after recording (PLN-19); the **wishes** screen, with recording a wish as an expense (PLN-9, PLN-18); and the **month review** (REV), where a carry-over envelope's part notes what came from its leftover (REV-4). These were added to the requirements on 2026-10-15 and changed on 2026-10-18 and 2026-10-25. Also Home's free-money card with its due payments (DSH-5), and the "Counts for" row on the transaction page, which says how a link was made, including a match by the app (PLN-14).
- The Add form's check against due payments (PLN-20, 2026-10-25), designed with Repeats: while an expense fits an unpaid due payment, Envelope is not filled by a rule or a default; the saved screen says "Counts as Rent, due 01/11/2026" with "Change"; and a payment that is already recorded gets a warning before saving, "Rent for November is already recorded", with "Open it" and "Save anyway". Offline, Repeats and the other actions that need a connection are disabled and say so (PLN-21).
- Prototype these in the order they are built (owner, 2026-10-25): Repeats on the Add form, then the recurring list and page, then the month plan with Confirm plan, then the wishes, then the review. The first three are enough to retire the spreadsheet.
- **Add profile**, the currency, coin, rate and time zone editors in Settings, **Split** (TXN-9) and **Attach receipt** (TXN-11). The prototype shows their entry points only.

## 3. Navigation

- **UI-NAV-1 (Must).** Home is the root. Every other screen is pushed on top of the screen that opened it and has a 44-point round Back button at the top left.
- **UI-NAV-2 (Must).** Back returns to the screen the member came from, not to a fixed parent. Its accessible label names that screen: "Back to home", "Back to check-ins", "Back to check-in", "Back to transaction", "Back to accounts". Examples: the summary opened from Home's wealth card goes back to Home; opened from the Check-ins list it goes back to the list. Use the router's history; when there is none (a notification or a reload opened the screen), fall back to the screen's natural parent.
- **UI-NAV-3 (Must).** After the check-in closes, "See summary" opens the summary, and Back from there goes to Home, not to the finished check-in. From spec 3 a closed check-in leads to the month plan instead (PLN-8, 2026-10-18), and the plan links to the summary. The design of the plan replaces this rule and UI-CHK-8's buttons.
- **UI-NAV-4 (Must).** Pickers, filters, short forms and confirmations open as bottom sheets over a dimmed page. A sheet has a drag handle, a title, and closes on its Close button, a tap on the dimmed area or a swipe down. The page behind the sheet does not scroll while it is open. A list in a sheet may be split into groups ("Recent", "All categories", "In use"); the group heading is a small uppercase label with clear space above it, so it never reads as a row (UI-VIS-9). A confirmation sheet states the consequence and offers the action and a way out ("Keep it", "Cancel", "Keep it open").
- **UI-NAV-5 (Must).** Links that open a screen in a particular state carry that state: "Move money" on Envelopes opens the move sheet with "From" and "To" chips, and on an envelope page the move sheet for that envelope; "History" on Envelopes opens a sheet listing the envelopes, and a pick opens that envelope on its History tab (spec 02, O10); "Transactions" on an account opens the list filtered to that account; "Needs a category" opens the Transactions tab of that name.
- **UI-NAV-6 (Must).** A notification about a check-in opens the check-in while it is open, and its summary once it is closed (CHK-9). From spec 3 it opens the month plan that the closed check-in leads to.
- **UI-NAV-7 (Must).** Chips are for a handful of one-tap choices (accounts, suggested categories, envelopes, the family's currencies), always followed by "All…" or "Other…" when the full list is longer. A long list, a calendar or a text entry opens in a sheet with search where it helps: the same sheets wherever a value is picked (Add expense, the transaction page, the envelope form). A pick from a sheet goes to the front of its chip row. Owner's decision, 2026-10-14.

Home entry points:

| Element | Opens |
|---|---|
| Check-in banner | Check-in |
| "Check-in" tile | Check-in while one is open, otherwise Check-ins, where "Start a check-in now" is (owner's decision, 2026-10-13) |
| "Income" and "Transfer" tiles | Add screen with that kind selected |
| Envelopes card | Envelopes |
| "Needs a category · N" | Transactions, Needs a category tab |
| Family wealth card | Latest closed check-in's summary |
| "Everything" grid | Transactions, Envelopes, Accounts, Check-ins, Wealth history, Categories, Reports, Settings |
| "Add expense" button | Add screen, Expense selected |
| Profile avatar | Profile sheet (UI-AUTH-5) |

## 4. Home

- **UI-HOME-1 (Must).** From top to bottom: date and greeting ("Hi, Alena") with the profile avatar and the eye button; the check-in banner while a check-in is open; three quick tiles (Income, Transfer, Check-in); this month's envelopes card ("October · Day 5 of 31", spent so far, one bar per envelope); "Needs a category" with its count, shown only when the count is above zero; the Family wealth card; the "Everything" grid; and a sticky full-width "Add expense" button at the bottom.
- **UI-HOME-2 (Must).** Amounts on Home are hidden every time the app opens. A hidden amount is shown as the currency symbol and dots ("€ • • • • •"), never as partial digits. While hidden, envelopes show the share used ("62% used") or "Over budget", and the wealth card shows "Hidden · last check-in 02/09/2026".
- **UI-HOME-3 (Must).** The eye button shows the amounts for 30 seconds, with the note "Amounts visible · hiding again in 30 s", whose number counts down each second (owner's request, 2026-10-13), then hides them again. Tapping it again hides them at once. The revealed state is never stored. Amounts revealed with the eye also hide the moment the page is backgrounded or left (`visibilitychange` to hidden, `pagehide`), so nothing shows on return or in the app switcher; a device that shows amounts by default (UI-HOME-4) is not affected.
- **UI-HOME-4 (Should).** Settings → This device → "Hide amounts on Home" is on by default. Turning it off shows amounts on Home on that device; the eye then hides them for the rest of the visit.
- **UI-HOME-5 (Must).** The check-in banner contains no amounts. It says who opened the check-in and what is left for the signed-in profile: "Monthly check-in is open · Opened today · 4 of your accounts to check", or "Check-in is open · Max started it today · 4 of your accounts left". When the signed-in profile started the check-in itself, it reads "You" in place of the name: "Check-in is open · You started it today · 4 of your accounts left". The opening day is written without digits ("today", "yesterday", "on Saturday", "over a week ago"), and a profile with nothing left reads "Opened today · you’re done".
- **UI-HOME-6 (Must).** Home shows one wealth figure: the equivalent in the common currency, with the change since the latest closed check-in when revealed (spec 01, O2): "+€1,742.00 since check-in of 02/09/2026". The totals per currency and the date of the oldest balance are on the check-in summary (DSH-1 as amended).

- **UI-HOME-7 (Must).** Limited Home (spec 02, D1). Offline, when the device is locked or nothing is loaded and the Add form's options are on the phone, Home shows only: the date and "Hi, Alena" with an "Offline" label in place of the eye and avatar; the Income and Transfer tiles (half the row each); "Waiting to send · N" when something waits, listing each item by merchant, or category when there is none, with its time and no amount; the note "Balances, envelopes and check-ins show when you’re back online." ("… back online and signed in." when locked); and the sticky "Add expense". Prototype: `HomeOffline.dc.html`, `HomeOfflineLocked.dc.html`.
- **UI-HOME-8 (Must).** Online, while anything waits or failed to send, Home shows the "Waiting to send · N" card under the tiles ("One couldn’t be sent. Open it to see why."), opening Transactions. Sign-out with unsent items asks first: "2 expenses haven’t been sent yet. Signing out deletes them from this phone." with "Sign out anyway" and "Keep me signed in" (spec 02, section 4). Prototype: `HomeWaiting.dc.html`.

Other screens that list money totals put the same eye button in their header. The Check-ins list hides its totals by default; Accounts, Account, Check-in and Summary show amounts by default because reaching them is deliberate.

## 5. Add expense, income and transfer

### 5.1 Layout

- **UI-ADD-1 (Must).** From top to bottom: a Close button and the kind control (Expense, Income, Transfer); the offline note when offline; the amount with its expression line and currency; the account chips; for expenses only, Merchant, Category and Envelope; a row of three tiles (Date, Paid by, Note); the keypad (UI-AMT-1); and the Save button. On iPhone in portrait the whole form fits without scrolling, the offline note included.
- **UI-ADD-2 (Must).** The account row is labelled "Paid from" (expense), "Paid into" (income) or "From" with a second "To" row (transfer). It offers the member's most used accounts as one-tap chips, cash included (TXN-2), and an "All…" chip that opens a search sheet ("Search: bank, person, currency"). An account picked from the search is added to the front of the row.
- **UI-ADD-3 (Must).** Merchant is a full-width field above Category and Envelope, showing "Add merchant" and "Optional" when empty. It opens a sheet "Search or type a merchant" that lists known merchants and lets the member add a new one.
- **UI-ADD-4 (Must).** Category shows suggested chips and "All…". "All…" opens a sheet "Search or add a category" with the groups "Recent" and "All categories" and an "Add category “…”" action when nothing matches. Income uses income categories. Transfers have no category.
- **UI-ADD-5 (Must).** Envelope shows one chip per active envelope. There is no "No envelope" chip: an empty envelope means none. Tapping a selected chip, in either row, clears it.
- **UI-ADD-6 (Must).** Date, "Paid by" ("Received by" for income, "Done by" for a transfer) and Note are tiles showing their current value. A tile whose value differs from the default (today, the signed-in profile, empty) gets a stronger border. Date opens a month calendar with future days disabled; Paid by opens the profiles with the hint "Who paid. The account above stays as picked."; Note opens a text sheet.
- **UI-ADD-7 (Must).** The Save button reads "Save €23.80" and is disabled with "Enter an amount" until the amount is valid and not zero.

### 5.2 How category and envelope are filled (CAT-5 as amended)

- **UI-ADD-8 (Must).** Nothing is selected when the form opens.
- **UI-ADD-9 (Must).** Picking a merchant that has a rule pre-selects the rule's category and envelope, but only in a field that is empty or was itself filled by a rule. The field label then reads "Category · from REWE rule" and the merchant hint "Rule applied · change". Changing the merchant replaces the values the previous rule set; a merchant without a rule clears them. A value the member picked by hand is never overwritten.
- **UI-ADD-10 (Must).** While the form is open, category and envelope do not fill each other. On save, an empty envelope takes the category's default envelope, and an empty category takes the envelope's default category. Before saving, the empty field's label previews this: "Category · optional · if empty, Groceries".
- **UI-ADD-11 (Must).** The saved screen says what was filled in automatically: "Groceries envelope added from the Groceries category."
- **UI-ADD-12 (Must).** To keep an expense out of every envelope even though its category has a default, the member clears the envelope on the transaction afterwards (UI-TXN-5 offers "None").

### 5.3 After saving

- **UI-ADD-13 (Must).** The saved screen shows "Expense saved" (or "Expense saved on this phone" when offline), a one-line summary ("€23.80 · REWE · ING Visa · Groceries"), and the buttons "Done", "Add another" and "Undo". An expense saved without a category adds "No category yet. It waits in Needs a category.", where "Needs a category" is a link.
- **UI-ADD-14 (Must).** Offline, the note "Offline. It stays on this phone and sends itself later." is shown and saving works (TXN-7). Until it is sent, the transaction carries the tag "Waiting to send" in lists.
- **UI-ADD-15 (Must).** A transfer between accounts in two currencies (TXN-4, spec 02 O11) shows a second line under the amount, "Arrives as $21.86", filled from the date's rate. A tap moves the keypad to it (the first amount dims; a tap on it moves back). Without a rate it reads "Type what arrives in Wise $" in the warning colour and Save stays disabled. Save reads "Save €20.00 → $21.86". Prototype: `AddTransferFx.dc.html`.

## 6. Amount entry

- **UI-AMT-1 (Must).** Every amount is typed on the app's own keypad, never the system keyboard (IOS-4). Its keys, in four rows of five: `7 8 9 ( )`, `4 5 6 × ÷`, `1 2 3 + −`, `. 0 % ⌫ C`. Operator keys use the softer surface colour.
- **UI-AMT-2 (Must).** Above the result, the expression is shown as typed once it contains an operator. The result updates while typing; while an operator, bracket or decimal number is still open, it shows the last complete result and no error. No error is shown before any number is entered. Saving stays disabled until the expression is complete. An invalid bracket expression shows "Can’t calculate that. Check the brackets.", division by zero shows "Can’t divide by zero.", an oversized amount shows "Amount is too large", and any other invalid complete expression shows "Can’t calculate that." (ACC-9).
- **UI-AMT-3 (Must).** Results are rounded to the currency's smallest unit. A leading minus is allowed where negative amounts make sense: refunds (TXN-8), envelope adjustments, and balances of accounts that are not "money we owe".
- **UI-AMT-4 (Must).** Balance sheets offer "Start from last" to put the previous balance into the expression, so a change can be typed as `+ 120`.

## 7. Check-in

- **UI-CHK-1 (Must).** The header shows "Monthly check-in" and who opened it: "Opened by schedule today, 09:00" or "Started by Max today, 09:12", with the family's progress ("12 of 21").
- **UI-CHK-2 (Must).** Profile tabs switch between members' accounts (CHK-5). Each tab shows "Done" or "N left" (CHK-10).
- **UI-CHK-3 (Must).** Accounts still to check are listed under "Your accounts to check · N". Each row shows the name, currency and "Last €1,986.30 on 02/09/2026", and a "Same" button.
- **UI-CHK-4 (Must).** "Same" stores a fresh check-in balance equal to the last one. It is not the same as "wasn't changed" (UI-CHK-7), which is a carried-forward value. Reconciliation treats the two differently (section 4.5 of the requirements).
- **UI-CHK-5 (Must).** Tapping a row opens the keypad sheet "New balance for ING Girokonto" with "Start from last", "Unchanged" and "Save & next". "Save & next" saves and opens the next account without a value. Each value is saved at once (CHK-6).
- **UI-CHK-6 (Must).** Checked accounts move to a done list showing the new value and its change ("▲ €120.00" or "Unchanged"). A tap reopens the sheet until the check-in closes (CHK-7). When the member's own accounts are done, the screen says "Your accounts are in" and offers "Fill in Max’s". A value another member enters, for this member's accounts or their own, appears here without a reload (UI-CHK-9). If it lands on the account open in the amount sheet, the sheet and the typed digits stay and a note above the amount reads "Another member entered €7,777.00. Saving replaces it." (the amount in the money format); saving still replaces it until the check-in closes (CHK-7).
- **UI-CHK-7 (Must).** The footer reads "It stays open until someone presses Close now. Next reminder in 2 days." with a "Close now" button. The second sentence names the next follow-up reminder ("today", "tomorrow" or "in N days", by calendar day in the family time zone) and is left out when reminders are off or nobody has accounts left to remind. Its confirmation says "3 accounts without a value will keep the last balance, marked as “wasn’t changed”." with "Close check-in" and "Keep it open". Owner's decision, 2026-10-13 (CHK-8): the check-in never closes by itself, so the prototype's "Closes by itself when everyone is in." is gone. The follow-up reminder then asks every member to close it (CHK-3). When every account has a value the footer reads "Everyone’s balances are in. Close the check-in to finish." and the "Close now" pill takes the primary look (ink fill, `--on-ink` text, same pill shape) so it is the obvious next step; the screen stays the open screen and every amount stays editable. Its confirmation then says "Every account has a value. Closing finishes the check-in and makes the summary ready." and carries nothing forward.
- **UI-CHK-8 (Must).** The closed screen offers "See summary" and "Back home". It is the same screen for every member: when someone else closes the check-in, the screen of a member who has it open switches to it at once and closes an open amount sheet or close confirmation. A line under "Everyone’s balances are in." says who closed it, in the words of the push notification ("Max closed the check-in."), when another member closed it; it is left out when the member closed it themselves, and for a record from before the 2026-10-13 decision that closed by itself (CHK-8; the Check-ins list still labels such a record "Closed by itself"). The screen does not open the summary by itself.
- **UI-CHK-9 (Must).** Live updates (owner's decision, 2026-10-12). While the check-in is open and the screen is visible and online, the screen follows the family's changes: it holds a server-sent events stream and re-reads the check-in on each signal, on every (re)connect of the stream, on return to the foreground and about every 30 seconds as a safety net. The stream carries only that a check-in changed or closed, with its id. While the page is hidden or offline, once the check-in is closed, and after the screen is left, there is no stream and no poll. A save or close that the server refuses because the check-in is already closed does not offer "Try again": the screen shows the closed screen (UI-CHK-8). Other failed saves keep "Try again" (UI-CHK-6, task 17). Home and the Check-ins list do not follow the stream; they refresh on focus, as before.

## 8. Check-ins and summary

- **UI-SUM-1 (Must).** Check-ins shows the open check-in as a card ("Open now · since today, 09:00", progress bar, "12 of 21 accounts · Max done · you 4 left · Sofia 5 left") or, when none is open, "Start a check-in now" with "Everyone gets a notification. Next scheduled: 5 November." Below it, closed check-ins with the date, who closed it and how many weren't changed, the family total (hidden by default) and its direction.
- **UI-SUM-2 (Must).** The summary page, top to bottom: "Check-in 02/09/2026 · Compared with 01/08/2026"; the total in the common currency with its change and previous value, split into "From balances" and "From exchange rates" (SUM-3, SUM-6); "Per currency" rows with total, previous and change (SUM-2); "Over time" chart (UI-SUM-3); "Biggest changes"; "Change by" Member or Account type with a total row; "Also in this check-in": what wasn't changed and accounts added or deactivated (SUM-5).
- **UI-SUM-3 (Must).** The chart has pills for "All in EUR" and each currency in its own unit (SUM-4). For the equivalent it adds a switch "Rate of each date" / "Today’s rates" (CUR-6). It labels its high and low values and its months. With fewer than two check-ins to draw it says "Not enough check-ins to chart yet." (decision of 2026-10-11: the prototype has no copy for this; the account page keeps "Not enough balance history to chart yet.").
- **UI-SUM-4 (Must).** Each "Biggest changes" row opens that account.

## 9. Envelopes

- **UI-ENV-1 (Must).** Envelopes shows "Left in all envelopes" and one card per envelope: name, mode tag ("Resets monthly" or "Carries over"), the amount left ("€187.60 left") or overspent ("−€14.50 overspent" in the warning colour with a warning outline), a progress bar, and "€312.40 spent of €500.00 · 6 expenses", plus the carried amount for carry-over envelopes. Below: "Move money", "History" and "Archived envelopes · N".
- **UI-ENV-2 (Must).** The envelope page shows the monthly amount and mode ("€500.00 a month · resets on the 1st"), the amount left, the month's spending and adjustments, the buttons "Move money" and "Adjust", and the tabs "October" and "History".
- **UI-ENV-3 (Must).** The month tab lists the expenses charged to the envelope; each opens its transaction.
- **UI-ENV-4 (Must).** History shows spending per month as bars against the monthly amount, the statistics of ENV-9 ("Within budget 3 of 5 months", average spent, largest overspend, left over net), a period selector, and the monthly records (ENV-6).
- **UI-ENV-5 (Must).** "Move money" picks a target envelope and an amount on the keypad (ENV-5). "Adjust" takes a signed amount and a note, with the hint "Use − to take money out. Applies to this month only." (reset envelopes) or "Use − to take money out. It carries over to next month." (carry-over envelopes).
- **UI-ENV-6 (Must).** New and edit envelope is a full page, like New account, with Back, the title "New envelope" or "Edit envelope", the form and the button at the bottom (`EnvelopeNew.dc.html`, `EnvelopeEdit.dc.html` show it as a sheet; changed by the owner on 2026-10-15). The keypad docks above the button while an amount is typed. Back returns to the screen that opened the page; Save on a new envelope opens its page, Save on an edit goes back to the envelope page, and Delete and Archive go to Envelopes. The pickers opened from the form stay sheets. The form has: Name; "Currency or coin" as chips of the currencies the family uses plus "Other…", which opens a searchable sheet grouped "In use" and "All currencies and coins" (UI-NAV-7; the chips are disabled with "The currency stays: it has expenses." once it is used, O6); "Monthly amount" on the keypad; "Each month" as "Resets monthly" or "Carries over" with a one-line explanation; "Starting balance · what’s in it now" (new only, proposing the monthly amount); "Default category · used on save when an expense has none" as None, three chips and "All…", which opens the category sheet ("Search or add a category", groups "Most used" and "All categories"). Editing the amount or mode shows "Applies from the top-up on 1 November." The bottom row offers "Delete" ("Unused, so it can be deleted."), "Archive" ("It has 6 expenses, so it can only be archived. They keep this envelope.") or "Restore". The button reads "Add envelope" or "Save".
- **UI-ENV-7 (Must).** The envelope header adds a pending plan in the accent colour ("From 1 November: €350.00 a month"); a carry-over envelope reads "€300.00 a month · carries over on the 1st" and its hero adds "€300.00 + €120.00 carried from September"; in the starting month the line reads "€45.00 spent of €187.60 · starting balance". The envelope page's settings button is the cog and opens the edit page.
- **UI-ENV-8 (Must).** The month tab lists adjustments and moves among the expenses by date, with a round icon: "Moved €50.00 to Eating out", "Added €50.00 · Birthday money", "Took out €20.00". A tap asks "Delete this adjustment?" or "Delete this move? Both envelopes change back." with "Delete" and "Keep it". Prototype: `EnvelopeCarryOver.dc.html`.
- **UI-ENV-9 (Must).** Envelopes' move sheet has "From" and "To" chips (same currency only, O5), the keypad, the hint "Groceries has €187.60 left" (warning colour when the move would take it below zero) and "Move €50.00 to Unexpected". The history picker lists each envelope with its mode, start and "3 of 5 months within budget". Archived envelopes is a list card with "Restore" per envelope and an undo message; empty, it reads "No archived envelopes."

## 10. Transactions

- **UI-TXN-1 (Must).** The list has a search field, two tabs ("All" and "Needs a category · N") and filter chips: period, member, account, category, envelope and kind (TXN-6). A chip opens a sheet with counts per option and "Reset"; an active chip is filled. "Clear" resets all. A summary line shows the count and sum of what is listed.
- **UI-TXN-2 (Must).** Rows are grouped by day with a day total. A row shows the merchant (or the category when there is no merchant), a meta line (account, member, category or envelope), the signed amount, and tags where they apply: "No category", "Waiting to send", "Refund", "Transfer".
- **UI-TXN-3 (Must).** The Needs a category tab (CAT-7) starts with "These were saved without a category. Tap a suggestion, or tick several and apply all." Each row has its suggestion as a one-tap chip and "Other…". Several rows can be ticked and labelled with "Apply suggestions to N". Every labelling can be undone from a short message. An empty tab says "Everything is labelled".
- **UI-TXN-4 (Must).** A transaction page shows the signed amount, merchant, "Monday 5 October · paid by Alena", and then one row per field in the order of the Add form: Paid from, Merchant, Category, Envelope, Date, Paid by, Note. Every row ends in a right chevron and opens a sheet, the same sheets as on Add expense (UI-NAV-7): Merchant and Category are searchable lists ("Search or type a merchant" with "Use “…”" and "No merchant"; "Search or add a category" with "Recent" and "All categories"); Envelope lists every envelope with its mode and what is left; Paid by lists the profiles; Date is the month calendar with future days disabled and "Today"; Note is a text box with "Done". "Paid from" opens the account. A transfer shows From, To, both amounts, Done by, Date and Note. Changed by the owner on 2026-10-14: rows no longer open in place.
- **UI-TXN-5 (Must).** The envelope sheet offers every envelope and "None", with "Changing it never changes the category." For an expense in another currency than its envelope, the row reads "Groceries · counts as €21.40" and the sheet adds "Counts in the envelope as" with the keypad and the rate it used ("At the rate of 2 October: $1 = €0.9149."); a typed amount is marked as typed by hand (spec 02, section 3.3). Prototype: `TransactionFx.dc.html`.
- **UI-TXN-6 (Must).** When the category of a transaction with a merchant changes, the page offers a rule: "Always label REWE as Groceries?" with "Save rule" and "Just this once" (CAT-6).
- **UI-TXN-7 (Must).** A "Record" section lists who entered the transaction and every later change with the profile and time (MEM-5).
- **UI-TXN-8 (Must).** Delete asks first and states the effect: "€64.20 goes back into Groceries. This can’t be undone."
- **UI-TXN-9 (Must).** Items still on the phone are listed at the top of their day with "Waiting to send" (`soft`) or "Couldn’t send" (`warn-soft`) and are left out of the day totals ("Items still on this phone are not in the day totals."). A tap opens a sheet with the item's details, the server's message for a failed one, a hint and "Delete" / "Keep it". Prototype: `TransactionsOutbox.dc.html`.

## 11. Accounts

- **UI-ACC-1 (Must).** Accounts has an owner control (Everyone, You, Max, Sofia), filter chips (Type, Currency, Show inactive), and groups by owner ("Yours", "Max’s"). A row shows "Name · currency", the type and the source and date of the balance, the balance, and a "Stale" tag (warning colour) or "Inactive" tag. A footnote explains: "Stale means the balance is older than the monthly check-in." (DSH-3)
- **UI-ACC-2 (Must).** The account page shows the balance, a chart with range options, "Set balance" (keypad, with "Today" or "Earlier date…"; ACC-6), "Transactions", and "Balance history · tap to correct", where each snapshot opens a sheet with "Save correction" and "Delete" (ACC-7). After creating an account, the account page replaces the form in navigation history and shows "Account added" once, with "Add another" (an empty form) and "Home"; Back returns to the screen that opened the form.
- **UI-ACC-3 (Must).** Account settings, opened from the cog icon: Name, Owner, Type, Currency, Bank IDs. Changing the currency warns "All 8 stored amounts are relabelled, not converted: €1,986.30 becomes $1,986.30. Use this only to fix a wrong currency." (ACC-5). "Deactivate account" asks first and explains that history stays; an account with history cannot be deleted, and the page says why (ACC-8).
- **UI-ACC-4 (Must).** New account asks for a name, owner, type, currency or coin ("Other…" opens the full list) and an optional opening balance with its date, "Optional. Becomes the first balance in its history." For "Money we owe" the hint reads "Type what you owe as a positive number. It’s stored as a negative balance." (ACC-2). The Back label names the screen that opened the form.

## 12. Categories and rules

- **UI-CAT-1 (Must).** Categories has the tabs Expense, Income and Rules. A category row shows its name, its default envelope and how often it was used this year. Archived categories are listed under "Archived · kept for history".
- **UI-CAT-2 (Must).** Editing a category offers its name and "Default envelope · used on save when an expense has none" (UI-ADD-10). An unused category can be deleted ("Unused, so it can be deleted."); a used one can only be archived.
- **UI-CAT-3 (Must).** Rules are an ordered list: "When a merchant matches, the expense gets this category and envelope. The first matching rule wins." A rule has "Merchant contains" (words separated by commas, such as "REWE, EDEKA, LIDL, ALDI"), a category, an envelope, and optionally one account.

## 13. Sign-in, profiles and first start

This replaces per-member logins (MEM-2 and MEM-3 as amended).

- **UI-AUTH-1 (Must).** The family shares one password. Each person has a profile (Alena, Max, Sofia). Everything a member records is attributed to the profile in use (MEM-5).
- **UI-AUTH-2 (Must).** Each device can remember a default profile. Sign-in then shows "Family password", "Sign in", "Use Face ID" and "Opens as Alena on this iPhone". A device without a default asks after the password: "Who’s using this iPhone? New expenses and check-ins are recorded under this name." with a "Remember on this device" switch.
- **UI-AUTH-3 (Must).** A wrong password shakes the field and says "That password doesn’t match. 2 tries before a short wait." After three wrong tries, sign-in waits 30 seconds with a countdown ("Wait 30 s"; SEC-2). The password field has a show/hide button.
- **UI-AUTH-4 (Must).** "Forgot password?" explains: "Anyone in the family who is still signed in can set a new one in Settings → Family password. If nobody is, reset it on the Mac mini as the README describes."
- **UI-AUTH-5 (Must).** The Home avatar opens "Who’s using the app?": the profiles as a radio list (the device default marked "Default on this iPhone"), a switch "Open as Alena on this iPhone", and "Sign out". Picking a profile switches at once and changes the greeting.
- **UI-AUTH-6 (Must).** Changing the family password asks for the current one and a new one of at least 10 characters, and says "Everyone uses the new one. Other phones and iPads are signed out and ask for it next time."
- **UI-AUTH-7 (Should).** "Unlock with Face ID" is a per-device switch in Settings (MEM-6). Turning it on asks for Face ID and registers a passkey for this device; turning it off deletes the passkey. Sign-in shows "Use Face ID" only on a device that has one (UI-AUTH-2); a cancelled Face ID prompt changes nothing, a failed one counts as a wrong try like a wrong password, and "Use Face ID" is disabled while sign-in waits and while offline. A browser without passkeys shows the row disabled ("This browser can’t use Face ID"). Added 2026-10-12 (task 29).
- **UI-AUTH-8 (Must).** First start asks for the family password twice and the profiles' names ("+ Add a profile"; "The first one opens on this device."), then shows next steps: "Add your accounts" and "Pick the check-in schedule", with "Later, go to Home". Create stays enabled (amended 2026-10-08; the prototype shows it disabled): tapping it with a password under 10 characters, a repeat that does not match or no profile name shows the error under that field and focuses the first one; editing a field clears its error.
- **UI-AUTH-9 (Must).** Added 2026-10-12 (MEM-7, SEC-9). When the app asks to sign in again after more than 5 minutes away, it shows the normal sign-in screen (UI-AUTH-2 to UI-AUTH-4) with one line above the password field: "Locked after more than 5 minutes away." (offline: "Locked after more than 5 minutes away. Connect to sign in."). Nothing from the screen the member was on stays visible. On a device with Face ID, Face ID is asked for once, by itself, when the screen opens; if the prompt is cancelled or WebKit refuses a prompt no tap started, nothing else happens (no message, no second prompt), "Use Face ID" takes keyboard focus, and the family password still works. A device without Face ID shows the password field only. After a successful sign-in the app opens the screen the member was on (an in-app path only; Home otherwise). A device with no default profile asks "Who’s using this iPhone?" first, as after any sign-in. Text typed on that screen and not saved is lost. Sign-in stays disabled offline (UI-AUTH-2, task 27). Offline, with the Add form’s options on the phone, a locked device shows the limited Home (UI-HOME-7, “… back online and signed in.”) instead of this screen; the sign-in screen shows when the connection returns, or at once when no options are stored.

## 14. Settings

- **UI-SET-1 (Must).** Sections, in order: Profiles; Sign-in (Family password, Unlock with Face ID, Sign in again when reopened); Check-in (Schedule, Follow-up reminders: a sheet of Every day, Every 2 days, Every 3 days, Every 7 days and Off); Money (Common currency, Currencies and coins, Exchange rates with the time of the last update, Time zone); Spending (Envelopes, Categories, Rules); This device (Notifications, Hide amounts on Home, Sign out); Data (Backup status, Export all data). A footer says where the app runs: "Budget Buddy · runs on your Mac mini · only reachable in your Tailscale network".
- **UI-SET-2 (Must).** The schedule sheet offers Off, Monthly with a day of the month, or Every N weeks with a weekday, plus a time, and previews the result in words (CHK-2): "Next check-in opens on 5 November at 09:00. Everyone gets a notification." Monthly also offers "Last day" below the 1–28 grid, and Every N weeks offers 1–8 weeks and Mon–Sun (added 2026-10-11; the prototype shows only the monthly state). With Off the preview reads "No check-in opens by itself. Start one from Check-ins." Done saves, Close discards. The Check-ins header shows the cadence under the title ("Monthly on the 5th, 09:00", "Every 2 weeks on Friday, 09:00", "Schedule off"), and the Settings row reads "Monthly, 5th, 09:00" or "Off".
- **UI-SET-3 (Must).** Before iOS asks for notification permission, a sheet explains it: "You’ll get a nudge when a check-in starts, a reminder if your accounts are still open, and a note when it closes. Notifications never show amounts." with "Continue" and "Not now" (NTF-2, NTF-4).
- **UI-SET-4 (Must).** Added 2026-10-11 with task 28; the prototype shows only the good state and no sheet. The Data section's Backup row keeps the design's look (a dot, "Backup", "Last today 03:30 · 4.2 MB · 14 daily, 12 monthly kept") and opens a sheet "Backup": "Every night at 03:30 Budget Buddy saves a copy of all your data in the backups folder on the Mac mini. It keeps 14 daily and 12 monthly copies.", then a list card with Last good backup, Size, Daily copies ("5 of 14") and Monthly copies ("2 of 12"), and Close. A failed night turns the dot to `warn` and the row reads "Last backup failed · last good one yesterday 03:30" ("· none saved yet" without a good one); the sheet adds an alert: "The backup failed today 03:32. The backup could not be written (ENOSPC). The earlier copies are kept as they were, and it tries again tonight at 03:30." Before the first backup: "No backup yet · runs every night at 03:30". "Export all data" ("CSV files in one .zip", a download icon) downloads the zip; while it is prepared the subtitle reads "Preparing the .zip…", and a failure shows "Could not export your data. Check your connection and try again." under the row.
- **UI-SET-5 (Must).** Added 2026-10-12 (MEM-7). The Sign-in card has a third row after "Unlock with Face ID": the switch "Sign in again when reopened", subtitle "On this iPhone, after more than 5 minutes away" ("this iPad", "this device" by `deviceName()`, like the Face ID row). It is on by default, saves at once for this device only, and is disabled offline with its state kept, like the other server actions. A failed save puts the switch back and shows "Could not save that setting. Check your connection and try again." under the card. The design export has no such row; it uses the Face ID row's markup and the existing switch, with no new CSS.

## 15. Visual system

The values below are implemented in `docs/design/html/bb.css`. Where a prototype screen differs from `bb.css`, `bb.css` wins.

### 15.1 Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F4F3EF` | `#111214` | Page background |
| `surface` | `#FFFFFF` | `#1A1C1F` | Cards, rows, chips, keys |
| `ink` | `#15171A` | `#F1F0EC` | Text, primary buttons, selected chips |
| `on-ink` | `#F4F3EF` | `#111214` | Text on `ink` |
| `muted` | `#5C6168` | `#A3A8AF` | Secondary text, hints, labels |
| `line` | `#E2E0D9` | `#2B2E33` | Borders and dividers |
| `soft` | `#EAE8E2` | `#24272B` | Operator keys, segmented control track, disabled buttons, bar tracks |
| `accent` | `#1D5C45` | `#7CC6A3` | Progress, positive change, links, switches on |
| `accent-soft` | `#DCEAE3` | `#1D3229` | Banner and highlighted backgrounds |
| `warn` | `#A2470F` | `#F2A574` | Overspent, stale, decreases on the summary, errors |
| `warn-soft` | `#F5E2D4` | `#3A2618` | Background of warning tags |
| `scrim` | `rgba(20,20,18,.36)` | `rgba(0,0,0,.55)` | Behind sheets |

- **UI-VIS-1 (Must).** The app follows the system appearance (IOS-7) using these tokens. No other colours are introduced.
- **UI-VIS-2 (Must).** Selection is shown with `ink` (a filled chip), never with `accent`. Colour is never the only signal: changes carry ▲ or ▼, and warnings carry words.

### 15.2 Type

- **UI-VIS-3 (Must).** Font: Geist (weights 400, 500, 600, 700), falling back to the system UI font. The prototype loads it from Google Fonts; the app must ship the font files itself, because SEC-7 forbids third-party fonts. The files and their licence are in `docs/design/html/fonts/`.
- **UI-VIS-4 (Must).** Base text is 15 px with a line height of 1.4. Screen titles 20 px semibold; hero amounts 30 to 36 px semibold with −0.02 em tracking; section labels 13 px medium in `muted`; field labels 12 px. All amounts use tabular figures.

### 15.3 Shape, spacing and components

- **UI-VIS-5 (Must).** Page side padding is 16 px, the gap between blocks 10 to 16 px. Radii: cards 18 to 20 px, fields and tiles 14 px, keypad keys 12 px, the primary button 18 px, sheets 24 px at the top. Chips are pills.

| Component | Spec |
|---|---|
| Primary button | Height 56, `ink` fill, 17 px semibold. Disabled: `soft` fill, `muted` text. |
| Choice chip | Height 44, horizontal padding 16, `surface` with `line` border; selected: `ink` fill. Rows of chips scroll sideways and run to the screen edges. |
| Filter chip | Height 36, 14 px; active: `ink` fill; optional caret. |
| Segmented control | `soft` track with 3 px padding; segments 32 to 36 high; selected segment `surface` with a light shadow. |
| Field button | Height 48, `surface`, `line` border, value right-aligned, chevron. |
| Meta tile | Height 52, small label above a bold value; stronger border when changed from the default. |
| List card | `surface` card, rows at least 56 high, divided by `line`, chevron when the row opens something. |
| Keypad key | Height 44 on Add expense (IOS-5 minimum touch target), 46 to 48 in sheets; `surface` on the page and `bg` inside a sheet; operators on `soft`. |
| Progress bar | 6 high, `soft` track, `accent` fill, `warn` when over. |
| Tag | 11 to 12 px semibold in a small rounded box: `warn-soft`/`warn` for warnings, `soft`/`muted` otherwise. |
| Switch | 51 × 31, `accent` when on. |
| Detail row | At least 54 high, label 96 wide in `muted`, value right-aligned, right chevron; opens a sheet (UI-TXN-4). |
| Sheet group heading | 11 px semibold uppercase, 0.08 em tracking, `muted`; 20 px above, 6 px below (`.t-group`). |
| Calendar day | 44 high, 12 radius; selected `ink` fill; future days in `line` and disabled. |

- **UI-VIS-6 (Should).** Icons are simple outline icons with a 1.8 to 2 px stroke at 18 to 22 px, in the style of Lucide. Bundle them; do not load them from a CDN (SEC-7). Settings, on any screen, is the cog (Lucide `settings`); the sliders icon is not used (owner, 2026-10-14).
- **UI-VIS-9 (Must).** Group headings inside a sheet list are small uppercase labels with space above them, so they read as section dividers, not as rows (owner, 2026-10-14).

### 15.4 Motion

- **UI-MOT-1 (Must).** Opening a screen slides it in from the right (0.42 s, `cubic-bezier(.32,.72,0,1)`); going back slides the previous screen in from the left (0.38 s). Sheets slide up from the bottom; the dimmed layer fades in over 0.3 s.
- **UI-MOT-2 (Should).** Bars and chart lines grow or draw in shortly after a screen opens. Buttons scale to 97 % while pressed. A wrong password shakes the field. Expanding rows and switches animate.
- **UI-MOT-3 (Must).** With "Reduce motion" on, all animation and transitions are off.

### 15.5 Page chrome

- **UI-VIS-7 (Must).** Browser and installed-app chrome uses the page `bg` in
  both appearances. The viewport covers the safe areas and every screen keeps
  content clear of them. Touch interaction uses `manipulation`, which prevents
  double-tap zoom while leaving pinch zoom available. A screen with its own
  scroll container does not also scroll or rubber-band the document.
- **UI-VIS-8 (Must).** Without a connection the app shows one note at the top,
  above the screen and below the notch: "You’re offline. Showing what was
  loaded last." (13 px, weight 500, `warn` on `warn-soft`, 10 px corners, the
  slashed-cloud icon of the style guide at 16 px). It takes the top safe area
  itself, so the screen under it starts flush. Actions that need the server
  are disabled; everything that only reads or navigates stays enabled.
  Screens never read `env(safe-area-inset-*)` directly; they use
  `--safe-area-top` and `--safe-area-bottom`.

## 16. Copy and formats

- **UI-TXT-1 (Must).** Dates in lists and headings are DD/MM/YYYY (section 11 of the requirements). Recent dates in transaction lists read "Today", "Yesterday" or "Sat 3 Oct".
- **UI-TXT-2 (Must).** Amounts read `€1,234.56`, with the currency symbol and the currency's decimals. A minus sign is U+2212 ("−€14.50"). Changes read "▲ €1,742.00" or "▼ ₽4,700.00", or "Unchanged".
- **UI-TXT-3 (Must).** Copy is short, plain English in the second person. Buttons are verbs that say what happens ("Save €23.80", "Close check-in", "Relabel as USD"). Confirmations state the consequence before the action.

UI words and the domain terms they stand for:

| UI | Requirements term |
|---|---|
| Profile | Member |
| Family password | The shared sign-in secret (MEM-2 as amended) |
| Same, Unchanged | A fresh check-in snapshot equal to the previous balance |
| Wasn’t changed | A carried-forward snapshot (CHK-8) |
| Needs a category | The list of CAT-7 |
| Check-in | Check-in |
| Stale | DSH-3 |

## 17. Accessibility

- **UI-A11Y-1 (Must).** Every icon-only button has a label that says what it does ("Show amounts for 30 seconds", "Back to home").
- **UI-A11Y-2 (Must).** Segmented controls are tab lists, chip groups that allow one choice are radio groups, and toggles report their state.
- **UI-A11Y-3 (Must).** Errors are announced (`role="alert"`). The masked amount has a label such as "Amount hidden".
- **UI-A11Y-4 (Must).** Text and icons meet WCAG AA contrast on their background in both appearances. Check `muted` on `soft` before using that pair for text.

## 18. Decisions that changed the requirements

The prototype review settled these. `docs/requirements.md` has been amended to match; the IDs are unchanged.

| Topic | Decision | Requirements touched |
|---|---|---|
| Sign-in | One family password and one profile per person, with a default profile per device. No per-member passwords and no invitations. | Section 2, section 4.1, MEM-1, MEM-2, MEM-3, SET-1, section 11 |
| Home | Home hides amounts by default and shows one wealth figure. Per-currency totals live on the check-in summary. | DSH-1 |
| Sign in again | A device asks to sign in again when opened fresh or returned to after more than 5 minutes away; on by default, with a per-device switch in Settings (owner, 2026-10-12). | MEM-2, MEM-7, SEC-9 |
| Pickers (2026-10-14) | Long lists, calendars and text open in sheets with search; chips only for a few one-tap choices, followed by "All…" or "Other…". The transaction page's rows open these sheets in the Add form's order. Settings is a cog everywhere. | None (design only) |
| Category and envelope | Merchant rules pre-select both while typing. Category and envelope fill each other only on save, and only into an empty field. There is no "No envelope" choice on the add form. | CAT-1, CAT-5, TXN-1 |

Known limits of the prototype that the implementation must not copy:

- It has one account page (ING Girokonto) and one envelope page (Groceries); every link to an account or envelope opens those.
- The Add expense form overflows by about 20 px on a 390 × 844 screen when the offline note is shown. UI-ADD-1 requires it to fit.
- Navigation history is faked with session storage; use the router.
- Data and dates are invented, with "today" fixed at Monday 5 October 2026.

## 19. Reading the prototype files

Each `*.dc.html` file is one screen: HTML markup with `{{holes}}`, `<sc-if>` and `<sc-for>` blocks, and a `Component` class whose `renderVals()` builds the values and handlers. Read it for structure, copy, states and the rules in the logic, such as the category and envelope rules in `AddExpense.dc.html` (`applyMerchant` and the post-factum block before `envLabel`).

Ignore these parts of the files: `navCapture` and every use of `sessionStorage` (they fake navigation direction and history), `data-props` (they switch canvas variants), the CSS selectors that start animations by matching inline styles, and the mock data constants. Variant files are copies of a screen with another starting state; when they differ in logic, `AddExpense.dc.html`, `Transactions.dc.html`, `Categories.dc.html`, `Settings.dc.html` and `SignIn.dc.html` are the reference.
