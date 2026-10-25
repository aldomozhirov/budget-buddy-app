# Budget Buddy: product requirements

Status: approved by the owner on 2026-10-05. Amended on 2026-10-06 after the prototype review: sign-in with a family password and profiles, the private home screen, and how category and envelope are filled in (section 3, MEM, DSH-1, DSH-4, CAT-1, CAT-5, SET-1, section 11). Amended on 2026-10-15 at the owner's request: the budget plan and the month review, which replace the family's planning spreadsheet and shared note (sections 1, 3, 4.1, 4.5, 4.7, 4.8, TXN-10, DSH-5, NTF-5, PLN, REV, COR-3, QUA-3, sections 8 to 11, appendix C). Specs 1 and 2 are unchanged by it. Amended on 2026-10-18 at the owner's request: "Needs a category" suggests a category only from a rule or an earlier transaction with the same merchant (CAT-7, spec 2 "Done when"). Amended again on 2026-10-18 at the owner's request: recurring incomes and expenses are set up on the Add form, and the month plan is put together from them, the envelopes and the month's wishes, which get a screen of their own; this replaces the separate list of plan lines, and the plan opens after every check-in. The family confirms each month's plan, and the review compares the month with that record; a payment the app matches to a due payment is logged on the transaction; a wish becomes an expense in one step (sections 3, 4.1, 4.7, 4.8, CHK-9, SUM-1, DSH-5, NTF-5, TXN-10, TXN-12 to TXN-14, PLN, REV, COR-3, QUA-3, sections 8 to 11, appendix C). It settles open questions 13 and 14. Specs 1 and 2 are unchanged by it. Amended on 2026-10-25 at the owner's request: a transaction that fits a due payment gets no envelope from a rule or a category's default, and the Add form says what it counts for; the Add form warns before a due payment that is already paid is saved again; carry-over envelopes in the review; and the defaults of 2026-10-18 are confirmed. Defaults were added for a link whose transaction moves to another month, rates for a coming month, envelope moves and adjustments in the plan, and what works offline (sections 4.7, 4.8, CAT-5, TXN-13, PLN-2, PLN-14, PLN-20, PLN-21, REV-4, QUA-3, sections 8 and 11). This document is the input for the `plan` agent. It is not a spec and contains no task list.

## How to use this document

- `plan` writes one spec per roadmap entry in section 8, in order. It may split a large entry into several spec files, keeping the order.
- Section 3 is decided. Do not ask the owner about it again, and do not change it without the owner.
- Section 10 is open. Settle each item by the trial it names, or by asking the owner, before writing the spec that needs it.
- Section 11 lists defaults the author picked without asking. Use them unless the owner says otherwise.
- Requirement IDs such as `ACC-1` are stable. Cite them in tasks and acceptance criteria.
- Priorities: **Must** means the spec is not done without it. **Should** is expected, and moves to a later spec only if the owner agrees. **Could** is built only when it is cheap.
- `plan` cannot edit this file. If a requirement changes during planning, record the change in the spec and tell the owner.
- How screens look and behave is in `docs/design-spec.md`, which cites these IDs. Read it before planning or building any screen.

## 1. Purpose and background

A family of two or three adults in Germany holds money in about 20 accounts (7 to 10 per person) in euros, US dollars, Russian rubles and crypto. They use three tools today:

- **budget-buddy-bot** is a self-made Telegram bot (`~/budget-buddy-bot`; TypeScript, Prisma, SQLite). About once a month it asks every member for the balance of each of their accounts. It then reports the family total per currency and the equivalent in euros, with history charts. Cash and debts are logged as accounts.
- **Goodbudget** is an iPhone app. The family logs every expense in it against three envelopes that are topped up monthly: Groceries, Eating out and Unexpected.
- **A planning spreadsheet and a shared note.** A Google spreadsheet lists the family's expected monthly income and its recurring costs: rent, utilities, subscriptions, groceries, transport, savings and others, plus yearly bills spread over twelve months. Income minus costs is the month's free money: what the family can spend on something this month or put aside for something bigger. At the start of each month the family writes in a shared Apple Note what they want to do with it. Appendix C maps the spreadsheet to this document.

What is wrong with this setup:

- The bot is limited: weak statistics and clumsy account management.
- Typing about 20 balances every month is tedious.
- Typing every expense is tedious, and many expenses are paid in cash.
- Nothing connects the tools, so the family cannot check that what they spend matches what their balances show.
- Nothing compares the plan and the note with what was actually spent and with what the balances show, so the family cannot see which parts of their budgeting work and where to improve.

The goal is one self-hosted web app, used mainly on iPhone and iPad, that replaces all of these tools, reduces typing, shows each month how much of the change in balances is explained by recorded income and spending, and shows how the month went against the family's plan.

The product is successful when:

- the family stops using the bot after spec 1, Goodbudget after spec 2, and the spreadsheet and the shared note after spec 3;
- a check-in needs no typing for an account whose balance did not change;
- an expense can be saved after entering only an amount;
- each month the app shows one unexplained amount per account and one for the family;
- each month the app shows the plan against what happened, and what worked, what did not and what to improve;
- no paid service is needed, and no third party sees account data.

## 2. Users, devices and host

| Topic | Fact |
|---|---|
| Members | Two or three adults who trust each other fully. They share one family password, and each has a profile. |
| Devices | iPhone and iPad, using the app installed on the Home Screen from Safari. Desktop browsers should work but are not the design target. |
| Host | A Mac mini (Apple M6, 32 GB, macOS 27) at home, always on. |
| Installed on the host | Docker through Rancher Desktop, Tailscale, Node 24, and LM Studio with a local model (Qwen 3.8 27B, MLX 4-bit). |
| Network | The app is reachable only inside the family's Tailscale network. |
| Language | English. |

## 3. Decisions already made

| Topic | Decision | Reason |
|---|---|---|
| Product | One custom app, not an existing tool such as Firefly III or Actual Budget. | Those are full-ledger tools. The check-in and the reconciliation would have to live in a second app beside them. |
| Data approach | Snapshot-first hybrid. Balance snapshots are the truth for wealth, transactions are the truth for flows, and reconciliation compares the two. A balance is never derived from transactions. | It tolerates missing data, and every import added later only improves accuracy. |
| Transaction detail | Bank transactions are imported only where that is cheap: ING, Revolut, Wise and Trade Republic. Other accounts stay snapshot-only. | A full ledger for about 20 accounts is too much work. |
| Categories and envelopes | Two independent labels on an expense, both optional. A category never turns into an envelope. | One envelope, such as Unexpected, pays for expenses of many categories. |
| Budgeting | Only envelopes have limits. Categories, recurring transactions and wishes have none, and income is not assigned to envelopes. The month plan (PLN) holds expectations, not limits: nothing is blocked or warned about when an expense is entered. Nobody plans every category each month: recurring transactions and envelopes carry on by themselves, and only the wishes are new each month. | Planning every category each month is unwanted. The family's spreadsheet already works this way: one list, changed only when something changes (owner, 2026-10-15). |
| Budget plan and review | The app replaces the planning spreadsheet and the shared note (section 1). A month review compares the month's plan with its transactions and with the check-ins, and says what worked, what did not and what to improve. The rules of sections 4.7 and 4.8 are the author's defaults (section 11), except where they name the owner. | Owner's request, 2026-10-15. |
| Month plan | The month plan is put together from what the app already holds: the recurring incomes and expenses, set up on the Add form (TXN-10), the envelopes, and the month's wishes, which have a screen of their own. There is no separate list of plan lines. Recurring transactions are fixed payments, such as rent, a subscription, a haircut or a salary. Variable costs are envelopes, so the spreadsheet's diesel and public transport become the envelopes Car expenses and Public transport. The plan opens after every check-in and shows how much the family's money is expected to grow or shrink over the month. A member then confirms it, and the month review compares what happened with that record. | Owner's request, 2026-10-18: each fact is entered in one place, and the check-in is when the family looks ahead. |
| Spreadsheet sections not taken over | The spreadsheet's emergency fund, savings goals and moving budget stay out (section 9). | Owner's decision, 2026-10-15. |
| Review rules | The month review's verdicts come from fixed rules over the figures, not from the local model. | The same figures must always give the same verdict, and the model is optional. |
| Envelope modes | Each envelope either carries its balance over or resets to its monthly amount. | Owner's decision. |
| Stack | TypeScript everywhere: a Vue 3 web app, a Node API, SQLite and Docker. Python is allowed only inside optional connector containers. | It is the language of the bot, so the owner can review the code. |
| Left to spec 1 | The API framework, database library and migration tool, test tools, chart library, UI component approach and package manager. | `AGENTS.md` assigns this to the first spec. The bot uses Prisma and Chart.js, which the owner knows; that is a hint, not a rule. |
| Packaging | One container holds the API, the built web app and the scheduled jobs. The data is one SQLite file and a folder of images on a mounted volume. | It is simple to deploy, and a backup is a file copy. |
| Hosting | The Mac mini, reached over HTTPS through Tailscale Serve. The app is never exposed to the public internet. | Privacy. iOS needs HTTPS to install a web app. |
| Local model | LM Studio on the host, called through its OpenAI-compatible HTTP API at a configured URL. It is optional: features that need it switch off when it is unreachable. | Containers on a Mac cannot use its GPU, so the model runs outside Docker. |
| Third parties | No account aggregators and no paid services. Allowed outbound traffic is listed in section 6.2. | The owner wants no provider between the family and its banks. |
| Common currency | Chosen in settings, EUR at first. | Owner's decision. |
| Rates | Each figure is converted at the rate of its own date. Charts can switch to today's rates. | The bot converts all history at today's rate; both views are useful. |
| Visibility | Every member sees and edits everything. There are no roles. | Full trust inside the family. |
| Sign-in | One family password and one profile per member. A device remembers a default profile and opens it after the password. | Owner's decision after the prototype review: simpler than a login each. Attribution to a profile relies on the same trust. |
| Privacy in public | The home screen hides amounts until a member reveals them (DSH-1). | The app is opened in shops and on public transport. |
| Language | English only. | Owner's decision. The bot is in Russian; the change is deliberate. |
| Reminders | An in-app banner and an iOS push notification. No Telegram. | Owner's decision. |
| Investments | The Trade Republic portfolio is one EUR value, not a list of holdings. Each crypto coin is an account in its own unit. | Holdings are not needed to measure wealth or leaks. |
| Automation order | Photo reading, then the import API with Apple Pay, then statement import, then connectors. T-Bank stays manual. | Owner's priority: simplify typing with photos first. |
| History | Importing the bot's history is optional. Goodbudget history is not imported. | Owner's decision. |

Architecture agreed with the owner:

```
iPhone / iPad: installed web app, iOS Shortcuts
        |  HTTPS, inside Tailscale only
        v
Mac mini - Tailscale Serve -> app container
                               - Vue web app (static files)
                               - Node API and scheduled jobs
                               - SQLite file and images (mounted folder)
           LM Studio (native) <- HTTP, optional
           connector containers (optional) -> import API
Outbound only: public price feeds, Apple push service
```

## 4. Domain model and rules

### 4.1 Terms

| Term | Meaning |
|---|---|
| Member | A person in the family, with a profile. Everything they record is attributed to their profile. |
| Account | A place where money is or is owed. It belongs to one member and has a type, one currency or coin, an active flag and a data source (by hand, statement import or connector). |
| Balance snapshot | The balance of an account at a moment, with its source: opening, by hand, check-in, carried forward, photo, statement or connector. |
| Check-in | A round in which every active account gets a fresh snapshot. The owner also calls it "accounts sync". The bot calls it a poll. |
| Transaction | An expense, an income or a transfer on an account, either draft or confirmed. |
| Transfer | A transaction between two of the family's accounts. Each side has its own amount and currency. |
| Category | What money was spent on or earned from. It is optional on a transaction. |
| Envelope | A shared spending allowance with a monthly amount, a currency and a mode. |
| Top-up | The monthly refill of an envelope. |
| Rate | The price of one currency or coin in another on a date. |
| Common currency | The currency in which totals across currencies are shown. |
| Draft | A proposed transaction or balance that counts nowhere until a member confirms it. |
| Evidence | A source record attached to a transaction: a typed entry, a photo, an Apple Pay event or a statement line. |
| Rule | A mapping from a merchant text pattern to a category and an envelope. |
| Unexplained amount | The part of a balance change that no confirmed transaction accounts for. |
| Connector | An optional program that fetches balances or transactions from a bank or a blockchain automatically. |
| Recurring transaction | An income or an expense that repeats on a schedule, such as a salary, rent or a subscription. It is set up on the Add form and expects one payment on each due date. |
| Due payment | One expected payment of a recurring transaction, on its due date. It is paid, or received, once a transaction counts for it. |
| Month plan | A calendar month's expected income and costs: the recurring transactions due in it, the envelopes' monthly amounts and the month's wishes. It is put together when shown, not kept as a list. It replaces the planning spreadsheet. |
| Recorded plan | A copy of a month plan as it stood when a member confirmed it, or when the app recorded it at the end of the month's first week. It never changes. The month review compares the month with it. |
| Free money | A month's expected income minus its expected costs: what is left to spend on wishes or to keep. |
| Wish | Something the family means to spend money on in a given month. Wishes replace the shared note. |
| Expected change | Free money minus the month's wishes: how much the family's money is expected to grow, or shrink, over the month. |
| Unplanned spending | Confirmed spending in a month that counts for no due payment, envelope or wish. |
| Month review | The page that compares a month's plan with its transactions and with the check-ins around it. |

### 4.2 Money rules

1. An amount is a whole number of the currency's smallest unit. Each currency or coin defines its number of decimals (EUR 2, JPY 0, BTC 8). Coins with more than 8 decimals are stored with 8. No floating point is used in storage or arithmetic, and amounts that can exceed JavaScript's safe integer range use BigInt or a decimal library.
2. A balance is signed. Money the family owes is a negative balance. Totals are plain sums.
3. Every amount is stored in its original currency. Converted figures are computed when shown and never stored. The one exception is the envelope amount of a foreign-currency expense (section 4.4).
4. A rate is stored per currency pair and date as an exact decimal. A figure dated D is converted at the rate of D, or of the nearest earlier date that has a rate.
5. A total across currencies is computed by adding each currency in its own unit, converting each currency total, and adding the results. One rounding rule, half away from zero to the smallest unit, is used everywhere.

### 4.3 Wealth at a moment

- An account's balance at moment T is its latest snapshot at or before T. It is zero before the account's first snapshot and from the account's deactivation on.
- The family's wealth at T is the total of all account balances at T, per currency and in the common currency.
- A closed check-in is valued at the rate of the day it closed.

### 4.4 Envelope balance

- An envelope is an allowance, not an account. Topping it up moves no money.
- **Carry over:** at each top-up the balance becomes the previous balance plus the monthly amount. A negative balance carries over too.
- **Reset:** at each top-up the balance becomes the monthly amount, whatever was left or overspent.
- A confirmed expense that names the envelope reduces its balance by the expense amount in the envelope's currency. A negative expense (a refund) restores it.
- An expense in another currency is converted at the rate of the expense date when it is confirmed. That converted amount is stored and does not change when rates change later. A member can overwrite it by hand.
- A member can adjust a balance by hand and move an amount between envelopes.
- An envelope month runs from one top-up to the next. An expense belongs to the month of its date.
- The closing balance of a month is the balance just before the next top-up. A month is within budget when its closing balance is zero or more.
- Both modes keep the same monthly record (ENV-6). In reset mode the reset drops the closing balance from the running balance, but it stays in the record.
- Monthly records are computed from the stored top-ups, adjustments and expenses. A later correction of an old expense therefore shows up in the record of its month.

### 4.5 Reconciliation

**Per account.** For two consecutive fresh snapshots of one account, in the account's own currency:

`unexplained = closing - opening - net`

`net` is income plus transfers in, minus expenses and transfers out, over the confirmed transactions on that account dated after the day of the opening snapshot, up to and including the day of the closing snapshot.

- A snapshot marked as carried forward is not fresh. It is skipped, and the period runs on to the next fresh snapshot.
- An account's first snapshot starts its history. There is no period before it.
- On an investment account the same difference is called market movement and is not counted as unexplained.
- A transaction dated on the day of a snapshot is assumed to be included in that snapshot. When that is wrong, or when a bank books a payment a few days late, a gap appears in one period and the opposite gap in the next. The running total of unexplained amounts exists to absorb this.

**Per check-in.** For the family, between the previous closed check-in and this one, in the common currency. `r0` and `r1` are the rates on the days the two check-ins closed, and own-currency amounts are converted at `r1`:

`change in wealth = income - spending + exchange differences + market movement + unexplained + currency effect + accounts added or deactivated`

- **Exchange differences** are the net of transfers between the family's accounts. They are zero when both sides have the same currency.
- **Currency effect** is each account's opening balance multiplied by `r1 - r0`. Any rounding remainder is added here, so the parts always add up to the change exactly.
- **Accounts added or deactivated** is the first balance of every account that had none at the previous check-in, minus the last balance of every account deactivated since.
- An account whose closing balance was carried forward contributes only its currency effect. Its transactions count in the period that ends with its next fresh snapshot.

Reports (RPT) use calendar months and convert each transaction at the rate of its own date. The reconciliation uses check-in periods and the closing rate. Their figures differ slightly by design. The month review (section 4.8) uses the calendar month for the plan and the transactions, and the check-in period nearest to the month for the balances.

### 4.6 Drafts, evidence and matching

How a record arrives depends on its source:

| Source | Arrives as |
|---|---|
| Typed by a member | Confirmed. |
| Statement file or connector | Confirmed, because it is the bank's own data. A transaction that no rule can label has no category and appears in the inbox. |
| Photo read by the model | Draft. |
| Apple Pay event | Draft. |

- A draft changes no total, envelope, report or reconciliation until a member confirms it.
- Every incoming record names its source and carries an external ID. The same pair is never stored twice.
- An incoming record matches an existing transaction when the account, the amount and the currency are equal and the dates are within a few days of each other (section 11). With exactly one candidate the two are merged into one transaction with several pieces of evidence. With several candidates the app asks.
- In a merged transaction the member's labels (category, envelope, merchant, note) are kept, and the bank's amount and booking date replace the typed ones.

### 4.7 Recurring transactions and the month plan

**Recurring transactions.**

- A recurring transaction holds what the Add form holds for an income or an expense: an amount, an account and its currency, a category, a merchant (expenses only), a member and a note. It also holds a schedule, an optional end date and the switch "Record by itself" (PLN-13). Its account is required, as on every transaction (TXN-5).
- A schedule repeats every week, every 2 weeks, every month, every 2, 3 or 6 months, or every year, counted from the first due date. Monthly and longer schedules keep the day of the first due date. In a month without that day, the payment is due on the month's last day.
- A recurring expense names no envelope. Its money is planned on its own (below), and an envelope would count it twice.
- Due payments are computed from the schedule, not stored. Only a change to one payment (another amount or date, or a skip) and the links to the transactions that paid it are stored.
- A change applies to "this and later payments" or to "this payment only" (TXN-13). A change to this and later payments ends the old schedule before that payment and starts a new one, so earlier months keep what they expected (COR-5).

**Month plans.**

- A month plan belongs to one calendar month in the family time zone. It is computed when shown, from:
  - each due payment of the month, at its expected amount: the recurring transaction's amount, or the amount changed for that payment;
  - each envelope active in the month, at its monthly amount for that month (ENV-4);
  - the month's wishes.
- Nothing is made on the 1st or copied from the previous month. A change to a recurring transaction, an envelope or a wish shows at once in every plan it affects. A past month's plan uses the schedules and envelope amounts that applied in that month.
- Expected amounts are converted to the common currency at the rate of the month's first day (section 4.2, rule 4). Actual amounts are converted at each transaction's own date, as in reports. The gap between the two is shown as rate differences, so the parts still add up.
- A coming month has no rate for its first day yet. Its plan uses the latest stored rate and marks the converted figures as estimated. From the first day on, the plan uses that day's rate. A recorded plan keeps the rates it was recorded with, estimated or not. The gap between those and the rates of the month's first day shows in the review as rate differences, not as changes after recording (section 11).
- Moving money between envelopes and adjusting an envelope's balance (ENV-5) change neither the plan nor the review. They are envelope bookkeeping and move no money (section 4.4), and real spending already counts (section 11).

**Free money and expected change.**

`free money = due recurring incomes - due recurring expenses - envelope amounts`

`expected change = free money - wishes`

- A payment counts in full in the month it is due, so that the expected change can be checked against the change in wealth at the next check-in (owner, 2026-10-18). A month with a yearly bill therefore expects less than a month without one.
- So that a month without such a bill does not look richer than it is, the plan also shows the monthly average of the recurring expenses that repeat less often than monthly: per currency, each amount divided by its length in months, added up and rounded once (section 4.2, rule 5), as in "Yearly and quarterly bills: €1,450.00 a year · €120.83 a month". It is information only and is not part of the sums (COR-4).
- Free money and the expected change can be negative. A negative expected change is shown as an expected decrease.

**The plan after a check-in.**

- A closed check-in leads to the plan of the month whose first day is nearest to the day it closed (owner, 2026-10-18). On a tie it leads to the later month. A check-in closed on 29 October or on 3 November leads to November's plan; one closed on 12 October leads to October's. With check-ins monthly on the 1st (CHK-2), it is always the month that is just starting.
- A month plan starts from the family's wealth at the closed check-in nearest to its first day, among those that lead to it. This is the check-in the review uses (section 4.8). The plan then shows the expected wealth after the month: that wealth plus the expected change, in the common currency. A month that no closed check-in leads to yet has no starting wealth.

**The recorded plan.**

- A month plan is recorded once. A member records it with "Confirm plan" (PLN-19), usually on the plan page after the check-in, once the wishes are in. If nobody has confirmed it by the end of the month's 7th day, the app records it then (owner, 2026-10-18). A plan can be confirmed before its month starts.
- The record is a copy of every item of the plan: each due payment with its name, due date, amount and currency, each envelope with its monthly amount, and each wish with its name, amount and currency. It also holds the free money, the expected change, the rates they were converted at, and who recorded it and when.
- The record never changes. Changes to a recurring transaction, an envelope or a wish still change the month plan, as above. The plan and the review show them as changes after recording: each item added, changed or removed, with its effect on the expected change.
- A month that was never recorded has no record. Its review compares with the plan as it stands and says so.

**What counts where.** Every confirmed expense part and every confirmed income dated in the month counts in exactly one place. The places are tried in this order:

1. An expense part charged to an envelope counts for that envelope, at its envelope amount (section 4.4). It cannot be linked to a due payment or a wish. Charging a linked expense to an envelope removes its link. A transaction that fits a due payment gets no envelope from a rule or a category's default (below), so only an envelope a member picks keeps it out of the plan's due payments.
2. A transaction linked to a due payment or a wish of its month counts there. A link is made when a due payment is recorded (PLN-12, PLN-13), when a wish is recorded as an expense (PLN-18), when the app matches a transaction to a due payment (below), or by a member (PLN-10, PLN-14).
3. Otherwise it is unplanned spending, or unplanned income.

- Transfers count nowhere. A refund counts where its expense would, as a negative amount. Drafts count nowhere (section 4.6).
- Links are stored, and so are recorded plans. Everything else is computed when shown, so a correction or a new label shows up at once.

**Matching a payment to a due payment.**

- When a confirmed transaction without a link is saved, imported or changed, or a draft is confirmed, the app looks for a due payment of its month that nothing counts for yet and that the transaction fits. The same check runs over the month's transactions when a recurring transaction is set up or changed. That check keeps every link already made, the app's included, and only fills due payments that nothing counts for yet (owner, 2026-10-18).
- A payment and its due payment are always in the same month. A payment made in another month than its due date is never matched to it and cannot be linked to it by hand. So the due day is set to the day the payment usually goes out or comes in (owner, 2026-10-18).
- A transaction fits when it has the same kind and account as the recurring transaction, the recurring transaction's merchant if it has one (matched as a rule matches, CAT-6), or else its category if it has one, and a date at most 7 days from the due date (section 11). The nearest due date wins, then the nearest amount. A recurring transaction with neither a merchant nor a category is paid only by recording it or by a member's link.
- A match is stored as a link made by the app. It is logged in the transaction's change history with the due payment it pays (MEM-5), and the transaction page shows it, as in "Pays Rent, due 01/11/2026 · matched by the app" (PLN-14).
- A transaction that fits a due payment nothing counts for yet gets no envelope from a rule or from its category's default (CAT-5), whatever its source (owner, 2026-10-25). Otherwise a rent whose category names an envelope would count for the envelope: the rent would show as not paid and the envelope as overspent. The transaction is matched instead. An envelope a member picks, on the Add form or later, is kept, and the expense then counts for the envelope. An expense saved offline is checked when it reaches the server.
- On the Add form the same check runs while an income or an expense is entered (PLN-20). When it fits no due payment that nothing counts for yet, but fits one that a transaction already counts for, the form warns before saving that the payment is already recorded (owner, 2026-10-25). This catches a payment typed after "Record by itself" or a member has already recorded it, which would otherwise count as unplanned.
- A member can undo a match or move the transaction elsewhere (PLN-14). The app then never matches that transaction to that payment again. A match made by the app is removed, and the removal is logged, when a later change to the transaction means it no longer fits. A link made by a member stays, unless the transaction's date leaves the month.
- When a linked transaction's date is changed to another month, its link is removed, whoever made it, and the removal is logged in its change history (MEM-5). In its new month the app tries to match it again. The due date of a single payment can be moved only within its own month (TXN-13). To pay it in another month, the member skips it and adds a wish to that month; an income that arrives in another month counts there as unplanned income (section 11).

**Free money left.** While the month runs, `free money left = free money - spent on wishes - unplanned spending - the amount by which due payments of recurring expenses are over their expected amounts`. Nothing raises it before the month ends. A payment under its expected amount, more income than expected, and money left in an envelope count only in the review. Envelopes keep their own balance (ENV-3).

### 4.8 Month review

**Three figures.**

- **Planned change** is the expected change of the recorded plan (section 4.7): what the family expected when it confirmed the month. A month without a recorded plan uses the plan as it stands, and the review says so.
- **Kept** is income minus spending over the month's confirmed transactions: RPT-1's amount saved.
- **Change in wealth** comes from the check-ins: the closed check-in nearest to the month's first day and the one nearest to the next month's first day, with the change between them split into the parts of section 4.5, summed over the check-in periods between them. It covers a slightly different period from the other two figures and includes market movement, currency effects and unexplained amounts, so it differs from "kept" by design. The review shows the two dates. With check-ins monthly on the 1st (CHK-2) the periods line up.

**Bridge.** The planned change turns into kept through parts that add up exactly (COR-4): each change made to the plan after it was recorded (an item added, changed or removed); each due payment above or below its expected amount (a payment not received or not paid counts in full), each envelope's spending below or above its monthly amount, each wish above or below its amount (a dropped wish, or one with nothing spent, counts in full), unplanned spending, unplanned income, and rate differences.

**Envelopes that carry money over** (owner, 2026-10-25).

- An envelope's part in the bridge is the plain difference between its monthly amount and its spending in the month, so the parts still add up. It is a figure, not a judgment: the envelope is judged only as ENV-6 does, within budget or overspent (below).
- When a carry-over envelope spends more than its monthly amount out of money carried in from earlier months, its part says so, as in "€120.00 came from September's leftover". The amount is the smaller of the excess and the balance carried in, when that balance is above zero.
- Money left in an envelope at the end of the month counts as kept. It is still the family's money, though the envelope keeps it as its balance (section 4.4).

**Judging.**

- A due payment is as expected, over or under, by the thresholds of section 11. One that nothing counts for by three days after its due date is "not paid yet" ("not received yet" for an income) while the month runs, and "not paid" ("not received") after it.
- An envelope is judged as ENV-6 does: within budget or overspent.
- A wish is done within its amount, done over it, still open, or dropped.
- A due payment, envelope or wish added, changed or removed after the plan was recorded is marked as such, with its recorded figures beside the current ones.
- The month is met when kept is at least the planned change.
- A review is provisional while its month runs. It is final once the month has ended and a check-in has closed after the next month's first day: no later check-in can be nearer.

**At a glance.** Three lists, at most five items each, largest amount first, with the thresholds of section 11:

- **Worked:** income as expected or above; recurring expenses as expected or under; envelopes within budget; wishes done within their amounts; kept at least the planned change; a small unexplained amount.
- **Didn't work:** income below expected or not received; recurring expenses over their expected amounts; envelopes overspent; wishes over their amounts; changes after recording that lowered the plan, such as wishes added during the month; unplanned spending above the planned change; kept below the planned change; a large share of spending without a category; a large unexplained amount, naming the accounts with the largest ones.
- **To improve**, from the last six closed months that have a review: a recurring expense over its expected amount in three or more of them (raise it to its average, or cut down); one under it in three or more (lower it, which frees money); a recurring income below its expected amount in three or more (lower it to its average); an envelope overspent in three or more (raise its monthly amount to its average spending, or cut down); a category with unplanned spending in three or more (add an envelope or a recurring expense at its average); kept below the planned change in three or more (the plan is too optimistic); the plan lowered after recording in three or more (add the wishes before confirming the plan); a large unexplained amount in two of the last three check-ins (record cash spending, or import statements for the accounts named).

## 5. Functional requirements

### MEM: members and sign-in (spec 1)

- **MEM-1 (Must).** On first start, when no member exists, the app shows a setup screen that sets the family password and creates a profile for each member, at least one.
- **MEM-2 (Must).** A device signs in with the family password and then opens a profile: the device's default profile, or one the member picks, optionally remembered as the default. A signed-in member can switch to another profile and set or clear the device's default profile at any time. The device stays signed in until it signs out or the session expires, unless it asks to sign in again when it is re-opened (MEM-7).
- **MEM-3 (Must).** Any signed-in member can add a profile, rename one, and deactivate or reactivate one. A deactivated profile cannot be opened. Its accounts and history stay. Any signed-in member can change the family password, which signs out every other device and deletes their push subscriptions (NTF-2); the device that makes the change stays signed in and keeps its subscription (owner's decision, 2026-10-11).
- **MEM-4 (Must).** Every member can see and change all data. There are no roles and no private accounts.
- **MEM-5 (Must).** Every snapshot, transaction and envelope adjustment stores who created it, who last changed it, and when. A corrected balance keeps its previous values in a change history.
- **MEM-6 (Could).** A device can be unlocked with a passkey (Face ID or Touch ID) instead of the family password.
- **MEM-7 (Must).** A device asks to sign in again when the app is opened fresh, or comes back to the foreground after more than 5 minutes away; a shorter absence does not lock it, and a device in use in the foreground is never locked, however long. It is on by default for every device, including those already signed in when it shipped. A per-device switch in Settings next to "Unlock with Face ID" turns it off (the device then stays signed in, as in MEM-2) or on; any member using the device can change it, and it affects no other device. With Face ID on the device, Face ID is asked for on that sign-in screen and success opens the device's profile at the screen where the member was; cancelling or failing leaves the normal sign-in with "Use Face ID" and the family password. Without Face ID the family password signs in and the device's default profile opens by itself. Nothing is lost silently: the app returns to the screen it was on, though text typed and not saved may be lost. Decided by the owner on 2026-10-12; design in spec 1, "Sign in again when the app is re-opened".

### ACC: accounts (spec 1)

- **ACC-1 (Must).** A member can create an account with a name, an owner, a type, a currency or coin, and an optional opening balance with its date (today by default). The opening balance becomes the account's first snapshot.
- **ACC-2 (Must).** The account types are bank, cash, investment, crypto, money we owe, and money owed to us. The type is used for grouping and for the reconciliation label (REC-2). It does not change the sign of a balance: section 4.2 applies. On a "money we owe" account the form asks for the amount owed and stores it as a negative balance.
- **ACC-3 (Must).** The accounts screen lists accounts grouped by owner, each with its currency, its latest balance, and the date and source of that balance. The list can be filtered by owner, type and currency. Inactive accounts are hidden unless asked for.
- **ACC-4 (Must).** An account's settings allow renaming it, changing its owner or type, and deactivating or reactivating it. Deactivation asks for confirmation and stores its date.
- **ACC-5 (Must).** An account's settings allow changing its currency. The app warns that this re-labels every stored amount of the account without converting it, and asks for confirmation.
- **ACC-6 (Must).** A member can set an account's balance by hand at any time from the account's settings. This stores a new snapshot dated now, or at a chosen earlier date.
- **ACC-7 (Must).** The account's page shows its snapshot history (date, amount, source, member) with a chart, and lets a member correct or delete any snapshot.
- **ACC-8 (Must).** An account can be deleted only while it has no snapshots and no transactions. Otherwise it can only be deactivated.
- **ACC-9 (Must).** Every field where a balance or an amount is typed accepts arithmetic with `+`, `-`, `*`, `/`, brackets and percent, as the bot does: `(11244.14 + 12441.12) / 2 * 10%`. The result is shown before saving and rounded to the currency's smallest unit. An invalid expression is rejected with a message, and nothing is saved.
- **ACC-10 (Must).** The currency of an account is any ISO 4217 code or a coin from a list kept in settings. Each has a number of decimals.

### CHK: check-in (spec 1)

- **CHK-1 (Must).** Any member can start a check-in at any time. Only one check-in can be open. Starting one while another is open joins the open one.
- **CHK-2 (Must).** Settings hold one check-in cadence for the family: off, monthly on a chosen day of the month, or every N weeks on a chosen weekday, each with a time of day. At that moment the app opens a check-in if none is open and reminds every active member (NTF-2). If one is already open, it opens nothing and reminds each active member who still has accounts without a value, once per member per slot, with the follow-up reminder of CHK-3; a follow-up and a slot reminder of the same minute give one push (owner's decision, 2026-10-11). When every active account already has a value in the open check-in, the slot sends every active member the reminder to close it instead of reminding no one (CHK-3, owner's decision, 2026-10-13).
- **CHK-3 (Should).** While a check-in is open, each member who still has accounts without a value gets a follow-up reminder at an interval set in settings. Owner's decision, 2026-10-13: since a check-in no longer closes by itself (CHK-8), once every active account has a value (and there is at least one) the same follow-up goes to every active member instead, asking them to close it: "All amounts are in. Close the check-in." It uses the same times, the same setting (Off sends none) and the same once-per-member-per-occasion rule, so nobody gets both texts for one occasion; if a value is cleared or an account is added, the follow-up for members with accounts left applies again. With no active accounts nobody is reminded. Opening the notification leads to the check-in.
- **CHK-4 (Must).** When a member starts a check-in by hand, the other members are notified and told who started it.
- **CHK-5 (Must).** The check-in screen shows all active accounts of the signed-in member on one screen, each with its name, currency, last balance and the date of that balance. For each account the member either taps "unchanged" (labelled "Same" in the design) or enters a new amount (ACC-9). "Unchanged" stores a fresh snapshot equal to the previous balance; only an account left without a value is carried forward (CHK-8). The member can switch to another member's accounts and fill those in too.
- **CHK-6 (Must).** Each value is saved on the server as soon as it is entered. An open check-in survives a restart of the app or the server and can be continued on another device.
- **CHK-7 (Must).** A value can be changed until the check-in closes. After that it is corrected through ACC-7.
- **CHK-8 (Must).** A check-in closes only when a member presses "Close now". Entering the last missing value does not close it: it stays open and every value stays editable (CHK-7) until someone closes it. Each account without a value then gets its previous balance, marked as carried forward; when every account has a value nothing is carried forward. Owner's decision, 2026-10-13: it used to close by itself on the last value, and the family found that inconvenient. Check-ins closed that way before this change keep no closing member and show "Closed by itself".
- **CHK-9 (Must).** When a check-in closes, every member is notified. The notification opens the summary page (SUM-1); from spec 3 it opens the month plan that the check-in leads to (PLN-8), which links to the summary.
- **CHK-10 (Should).** The check-in shows progress: which members have finished and how many accounts are still open.
- **CHK-11 (Must, from spec 4).** An account that received a fresh balance from a connector, a statement or a confirmed photo draft since the check-in opened is shown pre-filled and marked with its source. The member only confirms it.
- **CHK-12 (Must).** A member with no active accounts sees a prompt to create one instead of an empty check-in.

### SUM: check-in summary (spec 1)

- **SUM-1 (Must).** Every closed check-in has a summary page, shown right after closing. From spec 3 the month plan opens after closing instead (PLN-8) and leads to the summary. A list of past check-ins leads to each one. Summary pages are computed from the stored data, so a later correction shows up in them.
- **SUM-2 (Must).** The summary shows the family total per currency together with the previous check-in's total, the difference, and its direction (up, down or unchanged), as the bot does.
- **SUM-3 (Must).** It shows the equivalent of everything in the common currency, with the previous value, the difference and the direction.
- **SUM-4 (Must).** It shows a line chart over all check-ins. The chart shows the equivalent total by default, can switch to any single currency in its own unit, and can switch between each date's rate and today's rates (CUR-6).
- **SUM-5 (Should).** It shows what changed since the previous check-in: the accounts with the largest changes, subtotals per member and per account type, accounts added or deactivated, and which values were carried forward.
- **SUM-6 (Should).** It shows how much of the change in the equivalent comes from rate movement (the currency effect of section 4.5).
- **SUM-7 (Must, from spec 3).** It shows the period's income, spending and unexplained amounts, with a link to the reconciliation page.

### DSH: home screen and wealth history (spec 1)

- **DSH-1 (Must).** The home screen shows current wealth as one equivalent in the common currency, with the change since the previous check-in and that check-in's date; the wealth figure opens the latest check-in summary, where the totals per currency are (SUM-2). Amounts on the home screen are hidden every time the app opens, are revealed for 30 seconds on request, and can be set to show by default per device. It shows a banner while a check-in is open; the banner contains no amounts.
- **DSH-2 (Must).** A wealth history view charts wealth over time for a chosen period, broken down by currency, by account type or by member.
- **DSH-3 (Should).** A balance older than the check-in cadence is marked as stale wherever it is shown.
- **DSH-4 (Must, from spec 2).** The home screen offers "add expense" in one tap and shows the envelopes of the current month. While amounts are hidden (DSH-1) it shows each envelope's share used and whether it is overspent instead of its balance.
- **DSH-5 (Should, from spec 3).** The home screen shows this month's free money left (section 4.7) and opens the month plan. While amounts are hidden (DSH-1) it shows the share of the free money used instead, as the envelopes do. It also shows how many of this month's due payments wait to be recorded, and leads to the wishes (PLN-9).

### CUR: currencies and rates (spec 1)

- **CUR-1 (Must).** The common currency is chosen in settings. Changing it changes every converted figure in the app and no stored amount.
- **CUR-2 (Must).** A daily job stores the rates of every currency and coin in use. Rates are kept per date and never discarded.
- **CUR-3 (Must).** When a currency or coin comes into use, or data with past dates is added, the missing rates for those dates are fetched.
- **CUR-4 (Must).** When a price feed is unreachable, the app keeps working with the stored rates and shows how old the latest rate is.
- **CUR-5 (Should).** A member can enter or overwrite a rate for a date by hand.
- **CUR-6 (Must).** Wealth charts can be switched from each date's own rate to today's rates for all dates.
- **CUR-7 (Must).** Price feeds are reached through one internal interface, so a feed can be replaced without touching the rest of the app. The feeds themselves are chosen in spec 1 (section 10.1).

### NTF: notifications (spec 1)

- **NTF-1 (Must).** An in-app banner shows an open check-in to every member on every visit.
- **NTF-2 (Must).** The installed app receives push notifications on iOS through Web Push (iOS 16.4 or later). Each device opts in from settings, following a tap, as iOS requires. The events are: scheduled check-in, check-in started by a member, follow-up reminder, and check-in closed. A device that a family password change signed out receives no push until it signs in and opts in again (MEM-3): its notifications switch shows Off, since the server holds no subscription for it, until the member turns it on.
- **NTF-3 (Must).** The app works fully without push permission.
- **NTF-4 (Must).** Notification texts contain no amounts.
- **NTF-5 (Should, later specs).** Further events: drafts waiting, a connector failing, an envelope overspent, a new month starting, to add its wishes and confirm its plan (PLN-9, PLN-19), and a month review becoming final (REV-11).

### SET: settings (spec 1)

- **SET-1 (Must).** One settings area holds the profiles, the family password, the common currency, the coin list, the check-in cadence and reminder interval, the notification opt-in and the hiding of home screen amounts for this device, the backup status and the time zone.
- **SET-2 (Must).** Later specs add their settings to the same area: categories, envelopes and rules (spec 2), the model URL (spec 4), tokens and the card mapping (spec 5), connectors (spec 7).

### BKP: backup and export (spec 1)

- **BKP-1 (Must).** A nightly job writes a consistent backup of the database and of new images to a folder on the host. It uses SQLite's backup mechanism, not a copy of the live file, and keeps a set number of daily and monthly copies.
- **BKP-2 (Must).** The README describes how to restore a backup into a fresh install, and the procedure has been tested.
- **BKP-3 (Must).** Settings offer an export of all data as CSV files in one archive.
- **BKP-4 (Should).** Settings show the time and size of the last backup, and the home screen warns when the last successful backup is more than two days old.

### TXN: transactions (spec 2)

- **TXN-1 (Must).** A member can record an expense with an amount, a currency, a date, an optional category, an optional envelope, the account it was paid from, the member who paid, an optional merchant and an optional note. Only the amount must be entered. The defaults are today, the member's most used account, that account's currency and the signed-in member. The category and the envelope are filled in as CAT-5 describes.
- **TXN-2 (Must).** Adding an expense is one tap away from the home screen, and an expense can be saved after entering only an amount. The form offers the member's most used accounts, including cash, as one-tap choices.
- **TXN-3 (Must).** A member can record income with an amount, a currency, a date, an account, an optional income category, a member and a note.
- **TXN-4 (Must).** A member can record a transfer between any two accounts of the family with a date, the amount leaving one account and the amount arriving in the other. The two amounts differ when the currencies differ. A cash withdrawal, a currency exchange, a securities purchase and a debt repayment are all transfers.
- **TXN-5 (Must).** Every confirmed transaction belongs to an account. Reconciliation depends on this.
- **TXN-6 (Must).** Transactions can be listed, searched and filtered by period, member, account, category, envelope, kind and text. They can be edited and deleted.
- **TXN-7 (Must).** An expense entered without a connection is kept on the device, shown as waiting, and sent when the server is reachable again. A retry never creates a duplicate.
- **TXN-8 (Must).** A refund is recorded as an expense with a negative amount, so it restores the envelope and reduces the category total.
- **TXN-9 (Should).** One expense can be split into parts, each with its own category and envelope.
- **TXN-10 (Must, from spec 3).** An income or an expense can repeat. The Add form offers "Repeats" for both, but not for a transfer: every week, every 2 weeks, every month, every 2, 3 or 6 months, or every year, with an optional end date (section 4.7). With Repeats on, the date is the first due date and may be in the future, Envelope is hidden, and the category's default envelope is not filled in on save (CAT-5). Saving sets up a recurring transaction with the form's fields. When the first due date is today or earlier, saving also records that payment, as the form always does; a later first due date records nothing until the payment is due (PLN-12, PLN-13). To make a payment that is already saved the first one, the member uses "Repeat this" instead (TXN-14). Spec 2 deferred recurring transactions (D5). From spec 3 they replace the plan lines of the 2026-10-15 amendment (owner, 2026-10-18).
- **TXN-11 (Should; Must from spec 4).** An image can be attached to a transaction.
- **TXN-12 (Must, from spec 3).** A list shows every recurring transaction with its amount, account, schedule and next due date, with incomes and expenses apart. Ended ones are hidden unless asked for. It is reached from Transactions and from the month plan. A recurring transaction's page shows its due payments, both recorded and coming, and opens the Add form to change it.
- **TXN-13 (Must, from spec 3).** A change to a recurring transaction applies to "this and later payments" (the default) or to "this payment only", such as a smaller salary in one month (section 4.7). A single payment can be skipped. Its due date can be moved only within its own month; to pay it in another month, the member skips it and adds a wish to that month (section 4.7). A recurring transaction can be ended on a date. One with recorded payments cannot be deleted, only ended, and its transactions stay. Changing or deleting a transaction recorded from it changes only that transaction. Every change stores who made it and when (MEM-5).
- **TXN-14 (Must, from spec 3).** The page of an income or an expense that has no envelope and counts for no due payment offers "Repeat this". It opens the form with Repeats on, filled from the transaction, with the transaction's date as the first due date. Saving sets up the recurring transaction and links the transaction to its first due payment, as a link set by a member, instead of recording a new payment. This way a payment typed or imported before its recurring transaction existed becomes its first payment, with no duplicate (owner, 2026-10-18).

### CAT: categories (spec 2)

- **CAT-1 (Must).** Members manage a flat list of categories. Each is either an expense category or an income category. It may name a default envelope, which is filled in when an expense with this category is saved without an envelope (CAT-5). A category with transactions can be renamed or archived, not deleted.
- **CAT-2 (Must).** A category is optional on an expense and on an income. A transaction without one is confirmed like any other, and reports show it under "Uncategorised". A split transaction can have one category per part.
- **CAT-3 (Must).** First start offers a starter list of categories that the family can edit.
- **CAT-4 (Could).** Categories can be merged, and grouped one level deep.
- **CAT-5 (Must).** While a member enters an expense or an income, a rule that matches the merchant (CAT-6) pre-selects its category and envelope, in fields the member has not set by hand. Otherwise the app offers one-tap category suggestions: the categories used most often with the same merchant, with the chosen envelope, and by this member recently. During entry, category and envelope do not fill each other. On saving, an empty envelope takes the category's default envelope (CAT-1) and an empty category takes the envelope's default category (ENV-1), and the confirmation says what was filled in. The member can change either field or leave it empty; to keep an expense out of every envelope despite a default, the member clears the envelope on the saved transaction. From spec 3, neither a rule nor a default fills the envelope of a transaction that fits a due payment nothing counts for yet (section 4.7, PLN-20).
- **CAT-6 (Must).** A rule maps a merchant text pattern, optionally limited to one account, to a category and an envelope. When a member sets or changes the category of a transaction that has a merchant, the app offers to save that as a rule. Rules can be listed, edited, ordered and deleted in settings.
- **CAT-7 (Must).** Transactions without a category are collected in a list for later labelling. A row shows a suggested category, applied with one tap, only when a rule or an earlier transaction with the same merchant gives one; CAT-8's model later fills the rest. Several can be labelled at once.
- **CAT-8 (Must, from spec 4).** When the local model is reachable, it suggests a category for every item that rules and earlier transactions could not label, using the merchant, the note and the receipt content. A model suggestion is applied only when a member accepts it.

### ENV: envelopes (spec 2)

- **ENV-1 (Must).** Members manage envelopes. Each has a name, a monthly amount, a currency, a mode (carry over or reset), a starting balance and an optional default category. Envelopes belong to the family, not to a member. An envelope with expenses can be archived, not deleted.
- **ENV-2 (Must).** On the 1st of each month at 00:00 in the configured time zone, every active envelope is topped up according to its mode (section 4.4). The top-up happens exactly once per month. When the server was off on the 1st, it is made up at the next start.
- **ENV-3 (Must).** The envelopes screen shows for each envelope the balance left, the amount spent this month, the monthly amount and the expenses charged to it. An overspent envelope is clearly marked.
- **ENV-4 (Must).** A change to the monthly amount or the mode applies from the next top-up.
- **ENV-5 (Must).** A member can adjust an envelope's balance by hand with a note, and move an amount from one envelope to another.
- **ENV-6 (Must).** For every envelope and every month, in both modes, the app keeps a monthly record: the opening balance, the top-up, the adjustments, the amount spent, the closing balance, and whether the month stayed within budget (section 4.4). In reset mode the record keeps the leftover or overspend that the reset dropped.
- **ENV-7 (Must).** An envelope's currency is fixed once it has expenses.
- **ENV-8 (Could).** The day of the month for top-ups is a setting.
- **ENV-9 (Must).** Each envelope has a history view with its monthly records as a list and as a chart of spending against the monthly amount. It shows statistics for a chosen period: the number and share of months within budget, the average monthly spending, the largest overspend, and the total left over or overspent.

### REC: reconciliation (spec 3)

- **REC-1 (Must).** The app computes the unexplained amount for every account and every pair of consecutive fresh snapshots, as section 4.5 defines.
- **REC-2 (Must).** On investment accounts the same difference is labelled market movement and is kept out of the unexplained totals.
- **REC-3 (Must).** A reconciliation page per closed check-in lists every account with its opening balance, closing balance, income, spending, transfers in and out, and unexplained amount, in the account's currency. It shows the family's unexplained total in the common currency.
- **REC-4 (Must).** The page shows the change in the family's wealth split into the parts of section 4.5. The parts add up to the change exactly.
- **REC-5 (Must).** A chart shows the family's unexplained amount per check-in and its running total.
- **REC-6 (Must).** From an account's row a member can add a missing transaction with the account and period filled in, or book the whole remainder to a chosen category with one tap.
- **REC-7 (Must).** An account whose closing balance was carried forward shows "no fresh balance" and contributes no unexplained amount.
- **REC-8 (Should).** Each account shows how it is covered: by hand, by statements up to a date, or by a connector.

### RPT: reports (spec 3)

- **RPT-1 (Must).** Income against spending per month in the common currency, with the amount saved. Transfers are neither income nor spending.
- **RPT-2 (Must).** Spending by category per month, with the trend over months and a comparison with the average of the preceding months. Spending without a category is its own row, so the family sees how much is unlabelled.
- **RPT-3 (Must).** Spending by envelope per month against the monthly amount, with each month's closing balance and whether it stayed within budget (ENV-6).
- **RPT-4 (Must).** Wealth over time by currency, account type and member. This extends DSH-2.
- **RPT-5 (Must).** Every report can be filtered by period and member, and every figure opens the list of transactions behind it.
- **RPT-6 (Should).** The rows of every report can be exported as CSV.
- **RPT-7 (Could).** Spending by merchant, and one year against another.

### PLN: month plan and wishes (spec 3)

- **PLN-1 (Must).** The month plan of any calendar month is put together from the recurring incomes and expenses due in it (TXN-10), every envelope active in it at its monthly amount for that month (ENV-1, ENV-4), and the month's wishes (PLN-9), as section 4.7 defines. Nothing else is planned, and there is no separate list of plan lines: a change to a recurring transaction, an envelope or a wish shows in the plan at once.
- **PLN-2 (Must).** The month plan shows the expected income, with each recurring income and its due date; the expected costs, with each recurring expense and its due date and each envelope with its monthly amount; the free money; the wishes and their total; and the expected change, as an increase or a decrease. Amounts are shown in the common currency, and also in their own currency where it differs. A coming month whose first day has no rate yet marks its converted figures as estimated (section 4.7). The figures shown add up (COR-4).
- **PLN-3 (Must).** A recurring transaction that repeats less often than monthly counts in full in the month it is due (owner, 2026-10-18). The plan also shows the monthly average of these bills, for information and outside the sums (section 4.7).
- **PLN-4 (Must).** Every active envelope appears in the plan with its monthly amount for that month and links to the envelope. The amount and the mode are changed on the envelope (ENV-4). An envelope archived during a month leaves the plan from the next month.
- **PLN-5.** Removed on 2026-10-18. The plan has no saving line: the expected change is what the family means to keep, and the review judges it against what was kept (section 4.8).
- **PLN-6 (Must).** Any month's plan can be opened: the current month from Home (DSH-5), the plan after a check-in (PLN-8), past months from the list of reviews, and coming months to look ahead and add wishes. Nothing is made on the 1st or copied from the previous month, because the plan is computed when shown. Only its record is stored (PLN-19). The start of a new month can remind the members to add its wishes (NTF-5).
- **PLN-7 (Must).** A month plan is changed through its sources: a recurring transaction, for one payment or from that payment on (TXN-13); an envelope (ENV-4); or a wish. An extra cost expected in one month is a wish. A past month's plan can be corrected in the same way, and its review is then recomputed (as SUM-1). Its record stays as it was (PLN-19).
- **PLN-8 (Must).** The month plan opens after every check-in. It is the plan of the month whose first day is nearest to the day the check-in closed (section 4.7). It opens right after a member closes the check-in, and the check-in-closed notification opens it (CHK-9). At the top it shows the family's wealth at the check-in nearest to the month's first day, usually the one just closed, with the change since the previous check-in and a link to the summary (SUM-1). At the bottom it shows the expected change, the expected wealth after the month, and "Confirm plan" while the plan is not recorded (PLN-19).
- **PLN-9 (Must).** Wishes have their own screen. It lists one month's wishes and switches between months: the current month first, then earlier months, and coming months, so that a wish can be planned ahead. A wish has a name, an amount (ACC-9), a currency (the common currency by default), an optional category and an optional note. The screen shows the month's free money, the total of its wishes, and the expected change after them, which is negative when the wishes exceed the free money. Any member can add, change, tick off, drop or delete any wish (MEM-4). The screen is reached from Home and from the month plan. It replaces the shared note.
- **PLN-10 (Must).** A wish collects the expenses linked to it. A member records one from the wish in one tap (PLN-18), links one from the transaction page, or from the wish by picking among the month's unplanned expenses, where those whose category or merchant fits the wish come first. An expense charged to an envelope stays with its envelope and cannot be linked (section 4.7). A wish shows its amount, what was spent on it, and its state: open, done or dropped.
- **PLN-11 (Should).** An open wish can be moved to the next month in one tap. Wishes are not copied to the next month otherwise.
- **PLN-12 (Must).** From the month plan, or from a recurring transaction's page, a member records a due payment as received or paid in one tap. This creates a confirmed transaction with the payment's expected amount and the recurring transaction's account, category, merchant, member and note. It is dated on the due date or today, whichever is earlier, and linked to the payment. The amount and the date can be changed first. Several due payments can be recorded together. Each due payment shows whether it is paid.
- **PLN-13 (Should).** A recurring transaction can record its due payments by itself on their due dates, as PLN-12 does without the tap. The switch "Record by itself" is on the Add form and is off by default (owner, 2026-10-18). Nothing is recorded for a payment that a transaction already counts for (section 4.7). A transaction recorded this way says so on its page.
- **PLN-14 (Must).** The transaction page shows what a transaction counts for in the plan: an envelope, a due payment, a wish, or unplanned. For a link it says how the link was made: recorded from the due payment or the wish, matched by the app (section 4.7), or set by a member. A member can move it to another due payment or wish of its month, undo a match, or mark it as unplanned. Charging it to an envelope, or changing its date to another month, removes its link (section 4.7). Every link that is made, moved or removed is logged in the transaction's change history (MEM-5). An expense charged to an envelope shows its envelope and cannot be moved.
- **PLN-15 (Should).** While the month runs, the month plan shows each due payment as paid or not yet, each envelope's spending against its monthly amount, what was spent on each wish, and the free money left (section 4.7).
- **PLN-16 (Could).** A recurring transaction and a wish keep the expression their amount was typed with ("282 + 75") and show it under the amount, as the spreadsheet's formulas do.
- **PLN-17 (Must).** The export (BKP-3) includes recurring transactions, the changes and skips of single payments, wishes, links and recorded plans.
- **PLN-18 (Must).** A member records a wish as an expense from the wish: one tap, then the account that paid. This creates a confirmed expense with the wish's amount and category and the wish's name as its note, dated today and linked to the wish. The account is always asked for and never filled in (owner, 2026-10-18): the member's most used accounts are offered as one-tap choices with "All…", as on the Add form (UI-ADD-2), none is picked, and nothing is saved until one is. When the account's currency differs from the wish's, the amount is converted at the day's rate. The amount, merchant and date can be changed before saving. The expense has no envelope, because an envelope would take it away from the wish (section 4.7), and the category's default envelope is not filled in (CAT-5). The wish is then ticked off as done, unless the member keeps it open for more spending.
- **PLN-19 (Must).** A member records a month plan with "Confirm plan". The button is on the plan page after a check-in and on any month plan that is not recorded yet, including a coming month. A plan nobody has confirmed by the end of its month's 7th day is recorded by the app then (section 4.7). A recorded plan says who recorded it and when ("Recorded by Max on 02/11/2026", or "by the app"). It lists the changes made since, each with its effect on the expected change. A record cannot be changed or made again.
- **PLN-20 (Must).** While an income or an expense is entered on the Add form, the form checks it against the due payments of its month as section 4.7 does (owner, 2026-10-25):
  - When it fits a due payment that nothing counts for yet, Envelope is not filled in by a rule or by the category's default (CAT-5). The saved screen says what it counts for, as in "Counts as Rent, due 01/11/2026", with "Change", which offers the choices of PLN-14 and an envelope instead. An envelope the member picks by hand is kept, and the expense then counts for the envelope.
  - When it fits no such payment, but fits one that a transaction already counts for, the form warns before saving, as in "Rent for November is already recorded", and offers "Open it", which opens the recorded transaction, and "Save anyway", which saves it as a transaction that fits no due payment (CAT-5 applies as usual).
- **PLN-21 (Must).** Offline the Add form saves as before (TXN-7), without Repeats. Repeats, "Repeat this", recording a due payment (PLN-12), recording a wish as an expense (PLN-18) and changing wishes need a connection; offline they are disabled and say so. The month plan, the wishes, the recurring list and the review show when the app is back online, like every screen but the Add form (IOS-6). An expense saved offline is matched to a due payment when it reaches the server (section 4.7), so its saved screen does not say what it counts for and the warning of PLN-20 is not shown (section 11).

### REV: month review (spec 3)

- **REV-1 (Must).** Every month from the first one with a recurring transaction or a wish has a review page, reached from the month plan and from a list of months. It is provisional while the month runs and final once a check-in has closed after the month (section 4.8). It is computed from the stored data, so a later correction shows up in it (as SUM-1). The review is for the family as a whole: unlike RPT-5, it has no member filter.
- **REV-2 (Must).** The top of the review shows three figures in the common currency: the planned change from the recorded plan, kept, and the change in wealth according to the check-ins (section 4.8). Each opens its part of the page.
- **REV-3 (Must).** Plan against actual, item by item, in the item's currency and in the common currency: recurring incomes (expected, received, and as expected, over, under, not received yet or not received); recurring expenses (expected, paid, difference, and as expected, over, under, not paid yet or not paid); envelopes (monthly amount, spent, within budget, from ENV-6). An item added, changed or removed after the plan was recorded is marked, with its recorded figures beside the current ones.
- **REV-4 (Must).** The bridge from the planned change to kept, starting with the changes made after the plan was recorded, in parts that add up exactly (section 4.8). A carry-over envelope's part notes what it spent from money carried in, as in "€120.00 came from September's leftover", without judging it (section 4.8).
- **REV-5 (Must).** The free money: what was expected, each wish with its amount, what was spent on it and its state, the unplanned spending by category with "Uncategorised" as its own row (CAT-2), and the unplanned income.
- **REV-6 (Must).** The balances: the dates of the two check-ins used, the change in wealth between them split as REC-4, the unexplained amount, and a link to the reconciliation page (REC-3). When a check-in used is more than 7 days from the month's boundary, the section says so. Until a check-in has closed after the month, it says that it waits for one, and the rest of the review works.
- **REV-7 (Must).** "At a glance" shows three lists, "Worked", "Didn't work" and "To improve", made by the fixed rules of section 4.8. Each item names its recurring transaction, envelope, wish, category or account and the figure, and opens its detail.
- **REV-8 (Should).** A "To improve" item that changes the plan (raise or lower a recurring transaction to its average, add an envelope or a recurring expense for a category, change an envelope's monthly amount) can be applied from next month in one tap. A recurring transaction changes from its next payment on (TXN-13), and an envelope's amount through ENV-4.
- **REV-9 (Must).** Every figure opens the transactions behind it (as RPT-5). The balances open the reconciliation page.
- **REV-10 (Should).** A year view shows, for twelve months, the expected and actual amounts of each recurring transaction and envelope per month, the yearly bills in their due months, and kept against the planned change per month.
- **REV-11 (Should).** When a review becomes final, every member is notified (NTF-5). The text has no amounts (NTF-4), and opening the notification opens the review.
- **REV-12 (Should).** The rows of the review can be exported as CSV (as RPT-6).

### DRF: drafts inbox and rules (spec 4)

- **DRF-1 (Must).** Drafts behave as section 4.6 defines.
- **DRF-2 (Must).** The inbox lists drafts and uncategorised bank records with their source and evidence. A member can edit, confirm or discard each one, and confirm several at once.
- **DRF-3 (Must).** The home screen shows how many items wait in the inbox.
- **DRF-4 (Must).** Rules (CAT-6) label every new draft and bank record on arrival. An item that no rule labels gets suggestions as in CAT-5 and CAT-8.
- **DRF-5 (Must).** The inbox includes the unlabelled transactions of CAT-7, so everything that waits for a member is in one place.

### PHO: photo reading (spec 4)

- **PHO-1 (Must, first).** Before any photo feature is built, a trial measures the configured local model on real images supplied by the owner: at least 20 receipts, including long supermarket receipts and cash receipts, and at least 5 account-list screenshots from the family's bank apps. The trial records how often the total, date, merchant and currency are right and how long a reading takes. Its result decides whether to use the current model, load another one, or add a separate text-recognition step. The result is written into the spec.
- **PHO-2 (Must).** A member takes or picks a photo of a receipt in the app. The result is a draft expense with the merchant, date, total, currency, the payment method when visible, and a category suggested by a rule or else by the model.
- **PHO-3 (Must).** A member picks a screenshot of a bank app's account list. The app extracts account names and balances and maps them to known accounts. The mapping from a name on the screenshot to an account is remembered. The result is one balance draft per account. Confirmed drafts become snapshots and pre-fill an open check-in (CHK-11).
- **PHO-4 (Must).** The confirmation screen shows the image beside the extracted fields. Nothing the model reads counts until a member confirms it.
- **PHO-5 (Must).** Images and their content are sent only to the configured model URL. There is no cloud fallback.
- **PHO-6 (Must).** Reading runs in the background. The member can leave the screen and later finds the draft in the inbox. When the model is unreachable, the image is stored, the draft stays empty for typing, and the reading is retried later.
- **PHO-7 (Must).** The image is kept as evidence on the resulting transaction or snapshot.
- **PHO-8 (Could).** The line items of a receipt are read and proposed as a split (TXN-9).

### IMP: import API (spec 5)

- **IMP-1 (Must).** An HTTP import API accepts balances and transactions. Each record names its source and carries an external ID. Sending the same source and external ID again stores nothing new.
- **IMP-2 (Must).** The import API requires a token. Tokens are created, named and revoked in settings, shown once, and stored hashed. A token can only add records through the import API and cannot read any data. Settings show when each token was last used.
- **IMP-3 (Must).** Records arrive as confirmed or as drafts according to section 4.6.
- **IMP-4 (Must).** Incoming records are matched against existing transactions and merged as section 4.6 defines.
- **IMP-5 (Should).** Settings show, per source, the time of the last record, counts and recent errors.

### APL: Apple Pay shortcut (spec 5)

- **APL-1 (Must, first).** A trial on the family's phones records what the iOS Shortcuts "Transaction" trigger delivers (fields, number and currency formats) and how often it fires for their cards.
- **APL-2 (Must).** The app documents, per member, an iOS Shortcuts automation that posts the merchant, amount, card name and time of each Apple Pay payment to the import API with that member's token.
- **APL-3 (Must).** Each event becomes a draft expense. The paying account comes from a card-to-account mapping in settings, and the category from the rules.
- **APL-4 (Must).** Settings show a setup guide with the member's own address and token.
- **APL-5 (Should).** A setting confirms Apple Pay drafts automatically when a rule supplies the category.
- **APL-6 (Must).** Nothing depends on the trigger having fired. Payments it missed are caught later by statement import and by reconciliation.

### STM: statement import (spec 6)

- **STM-1 (Must, first).** The owner supplies real statement exports from ING, Revolut, Wise and Trade Republic. The spec records each format (columns, separators, number and date formats, encoding) and whether the Trade Republic export covers the cash account. Real files stay out of the repository, and tests use anonymised files.
- **STM-2 (Must).** A member uploads a statement file for a chosen account. One parser per bank and format turns it into transactions, and into a balance when the file states one.
- **STM-3 (Must).** Before anything is stored, a preview shows which rows are new, which match existing transactions, and which were imported before.
- **STM-4 (Must).** Uploading the same file, or a file that overlaps an earlier one, creates no duplicates.
- **STM-5 (Must).** A movement between two of the family's accounts is recognised from identifiers stored on each account, such as the IBAN. It becomes one transfer, not an expense and an income.
- **STM-6 (Must).** Rows are labelled by rules first. A row without a rule gets a suggestion from the model when it is reachable, and otherwise stays without a category.
- **STM-7 (Must).** Trade Republic securities trades become transfers between the cash account and the portfolio account. Dividends and interest become income.
- **STM-8 (Should).** A generic CSV import lets a member map columns by hand, for banks without a parser such as T-Bank.
- **STM-9 (Could).** PDF statements are read by the local model.

### CON: connectors (spec 7)

- **CON-1 (Must, first).** Every connector starts with a trial against the owner's real account, followed by a decision to build it or drop it. The reason is written into the spec.
- **CON-2 (Must).** Each connector runs in its own optional container, keeps its credentials in its own environment, and only pushes data through the import API with a token. The main app never stores bank credentials.
- **CON-3 (Must).** Connectors only read. Nothing in this product can move money.
- **CON-4 (Must).** Connectors run daily and when a check-in opens. Settings show each connector's last success and last error. A failing connector blocks nothing.
- **CON-5 (Must, subject to its trial).** Wise: the balances of all currency accounts, through a read-only personal API token.
- **CON-6 (Must, subject to its trial).** Crypto: the balances of the owner's public addresses, read from a public explorer or node. No private key or seed phrase is ever entered.
- **CON-7 (Must, subject to its trial).** ING: balances and transactions through FinTS, with a registered product ID.
- **CON-8 (Could).** Trade Republic through the unofficial `pytr` library. It is fragile and not endorsed by the bank, so it stays off unless the owner asks for it.

### MIG: import of the bot's history (optional, any time after spec 1)

- **MIG-1 (Could).** A one-off command imports a copy of the bot's SQLite database. Users become members, vaults become accounts, polls become closed check-ins, and vault statuses become snapshots. Amounts are converted from floats to whole smallest units, and negative amounts are kept. The schema is in `~/budget-buddy-bot/prisma/schema.prisma`.
- **MIG-2 (Could).** The command shows what it will create before writing. Running it twice creates nothing twice.
- **MIG-3 (Could).** Rates for the imported dates are fetched (CUR-3).

## 6. Non-functional requirements

### 6.1 DEP: deployment

- **DEP-1 (Must).** `docker compose up -d` starts the whole app from one image. The image runs on linux/arm64.
- **DEP-2 (Must).** All state lives in one mounted data directory: the database, the images and generated keys. The container can be deleted and recreated without loss.
- **DEP-3 (Must).** Configuration comes from `.env`. `.env.example` lists every variable. No secret is committed.
- **DEP-4 (Must).** Database migrations run at start. A backup is taken before a migration. A failed migration stops the start and leaves the data as it was.
- **DEP-5 (Must).** The container restarts by itself after a crash or a reboot, and exposes a health check.
- **DEP-6 (Must).** The container's port is bound to localhost on the host. Tailscale Serve on the host provides HTTPS and forwards to it. Tailscale Funnel is not used.
- **DEP-7 (Must).** The README covers first install, update, restore, and the host preparation of section 10.3.
- **DEP-8 (Should).** The idle app uses little memory, because the local model needs most of the host's 32 GB.
- **DEP-9 (Must).** The time zone is a setting. It governs "today", top-ups, reminders and month boundaries.
- **DEP-10 (Must).** Optional parts such as connectors are separate services in the compose file and are off by default.

### 6.2 SEC: security and privacy

- **SEC-1 (Must).** Every page and API route requires a signed-in member. The exceptions are the health check, the sign-in and first-start screens, and the import API, which requires a token.
- **SEC-2 (Must).** Passwords are stored with a memory-hard hash. Repeated failed sign-ins are slowed down.
- **SEC-3 (Must).** The session cookie is HttpOnly, Secure and SameSite. State-changing requests are protected against cross-site request forgery.
- **SEC-4 (Must).** The server validates every input: amounts, currencies, dates, identifiers, file types and file sizes.
- **SEC-5 (Must).** Uploaded images are stored outside the served web files and delivered only to signed-in members.
- **SEC-6 (Must).** Logs never contain passwords, tokens, bank credentials or image content.
- **SEC-7 (Must).** The app loads no third-party scripts, fonts or analytics, and sends no telemetry.
- **SEC-8 (Must).** The app makes no outbound connections other than these:

| Destination | Data sent | Used for |
|---|---|---|
| Public price feeds | Currency codes and dates | Rates |
| Apple's push service | An encrypted notification with generic text | Reminders |
| A public blockchain explorer or node | The owner's public addresses | Crypto balances (spec 7) |
| The banks' own interfaces | The owner's credentials, sent by the connector containers | Wise and ING (spec 7) |

LM Studio runs on the host, so calls to it do not leave the machine.

- **SEC-9 (Must).** The five-minute rule of MEM-7 is the server's: after more than 5 minutes without the app saying it is in use, the server refuses every request of that session, and ends its live stream, until the device signs in again. This holds for a tab that never ran the app's timer. Failed sign-in attempts on a locked device count toward the existing lockout (SEC-2), and the family password change, sign-out and the password reset command keep their rules. Push subscriptions stay, so a locked device still gets notifications. Decided by the owner on 2026-10-12.

### 6.3 IOS: behaviour on iPhone and iPad

- **IOS-1 (Must).** The app can be installed on the Home Screen and runs there without browser controls.
- **IOS-2 (Must).** It is designed for iPhone in portrait first. On iPad it uses the extra width in both orientations. It stays usable in a desktop browser.
- **IOS-3 (Must).** It supports the current and the previous major version of Safari on iOS and iPadOS.
- **IOS-4 (Must).** Amount fields offer digits, a decimal separator and the operators of ACC-9 without switching keyboards.
- **IOS-5 (Must).** Touch targets are at least 44 points, and content stays clear of the notch and the home indicator.
- **IOS-6 (Must).** Without a connection the app still opens, shows that it is offline, and allows entering expenses (TXN-7).
- **IOS-7 (Should).** The app follows the system's light or dark appearance.

### 6.4 COR: correctness

- **COR-1 (Must).** The money rules of section 4.2 hold everywhere, including imports and tests.
- **COR-2 (Must).** A transaction carries a calendar date without a time zone. A snapshot carries a moment in time.
- **COR-3 (Must).** Every scheduled job (top-ups, payments recorded by themselves, plans recorded by the app, rates, backups, reminders, connectors) can run twice without doing its work twice, and makes up for a run it missed while the server was off.
- **COR-4 (Must).** A total shown on a screen equals the sum of the parts shown with it.
- **COR-5 (Must).** Accounts, categories, envelopes and members that have history are archived, never deleted.

### 6.5 PRF: performance

- **PRF-1 (Must).** The app is sized for one family: 3 members, 40 accounts, 10 years of history and 100,000 transactions. At that volume every screen answers within one second on the host.
- **PRF-2 (Must).** Slow work (model calls, imports, backups) runs in the background and never blocks a request.

### 6.6 QUA: quality

- **QUA-1 (Must).** The definition of done in `AGENTS.md` applies to every task.
- **QUA-2 (Must).** End-to-end tests run in the WebKit engine at iPhone and iPad sizes, because Safari is the target.
- **QUA-3 (Must).** Unit tests cover the money logic with these edge cases: rounding, negative balances, missing rates, month ends, leap years, daylight-saving changes, cross-currency transfers, carried-forward snapshots, jobs run twice or late, recurring schedules across month ends and leap years, a linked payment moved to another month, a plan recorded before its month's first rate, a carry-over envelope spending money carried in, and the month review's bridge adding up exactly.

## 7. Integration feasibility

The "Checked" column says whether the claim was confirmed by a web search on 2026-10-04 (sources in appendix B). Unchecked claims must be confirmed by the trial of the spec that uses them.

| Source | Route without an aggregator | Limits | Checked |
|---|---|---|---|
| ING (Germany) | FinTS, the bank's own protocol, at `https://fints.ing.de/fints/`: balances and transactions for the current account, savings account and securities account. The Python library `python-fints` implements it. | FinTS clients must be registered with Deutsche Kreditwirtschaft and get a product ID, which takes up to two weeks. Approvals in the ING app are to be expected; how often is unknown. The fallback is the CSV export. | Yes, except the approval frequency |
| Wise | Personal API token. | In the EU a personal token cannot fetch statements without extra authentication steps. Whether balances work without them is unconfirmed. The fallback is the CSV statement. | Partly |
| Revolut | Statement export from the app. | There is no API for personal accounts. | Yes |
| Trade Republic | Official CSV export in the app, released in April 2026. | Confirmed for securities trades. Whether it covers the cash account is unknown. The unofficial `pytr` library exists and is fragile. | Partly |
| T-Bank (Russia) | Statement file or typing. | No direct route is known. Integration is explicitly low priority. | No |
| Trust Wallet | Balances read on-chain from the owner's public addresses. | Needs a public explorer or node per chain. Which chains and coins are held is unknown. | No |
| Cash (EUR, USD, RUB) | Typing, and receipt photos read by the local model. | Whether the current model reads images is unknown. | No |
| Apple Pay payments | An iOS Shortcuts "Transaction" automation (iOS 17 or later) that posts the merchant and amount to the app. | No Wallet API exists for web apps. The trigger is known to time out, and some terminals never report to Wallet. The phone must reach the host. | Yes |
| Exchange rates | Public feeds. | The ECB has published no ruble rate since 1 March 2022, so RUB needs a second source such as the Bank of Russia. Coins need a price feed. | Yes for the ECB |
| Aggregators | Out of scope. | GoCardless Bank Account Data has accepted no new accounts since July 2025. | Yes |

## 8. Roadmap

Each entry leaves the app usable on its own. Cross-cutting requirements (section 6) apply from spec 1 on.

### Spec 1: foundation and wealth

- **Goal:** replace the bot.
- **Scope:** MEM, ACC, CHK-1 to CHK-10 and CHK-12, SUM-1 to SUM-6, DSH-1 to DSH-3, CUR, NTF-1 to NTF-4, SET-1, BKP, and the project skeleton with Docker, HTTPS through Tailscale, and the installable web app.
- **Trials first:** price feeds, push notifications on the family's devices, and the Tailscale Serve setup (section 10.1).
- **Also:** fill in "Stack and commands" in `AGENTS.md`.
- **Done when:** the app runs on the Mac mini and is reachable only through Tailscale; two members complete a check-in from their phones; the summary shows the comparison with the previous check-in and the chart; a scheduled reminder arrives as a push notification on an iPhone; a backup has been restored into a fresh container.

### Spec 2: spending

- **Goal:** replace Goodbudget.
- **Scope:** TXN, CAT, ENV, DSH-4.
- **Depends on:** spec 1.
- **Done when:** the three envelopes exist with the balances taken over from Goodbudget; an expense typed without a connection arrives exactly once after reconnecting; a month change tops up one carry-over envelope and one reset envelope correctly, also when the server was off on the 1st; after that change both envelopes show the closed month's closing balance and whether it stayed within budget; an expense saved with only an amount is listed for labelling.

### Spec 3: plan, reconciliation and reports

- **Goal:** replace the planning spreadsheet and the shared note, and show where the money went, against the plan, and whether any is unaccounted for.
- **Scope:** TXN-10, TXN-12 to TXN-14, PLN, REC, RPT, REV, SUM-7 and DSH-5, and the changes to CHK-9 and SUM-1 for the plan after a check-in (PLN-8).
- **Depends on:** specs 1 and 2.
- **Owner's answers:** open questions 13 and 14 were settled on 2026-10-18 (section 10.1).
- **Design first:** the Repeats choice on the Add form, "Repeat this" on a transaction, the recurring list and page, the month plan and the way a closed check-in leads to it, Confirm plan, the wishes screen with recording a wish as an expense, the match shown on the transaction page, the month review, the reports and the reconciliation page are designed in the prototype and approved by the owner before their tasks are built (`docs/design-spec.md`, section 2). They are prototyped in the order they are built: Repeats on the Add form, with what a typed payment counts for and the warning of PLN-20; then the recurring list and page; then the month plan with Confirm plan; then the wishes; then the review (owner, 2026-10-25). The first three are enough to retire the spreadsheet.
- **Order:** recurring transactions, the month plan and the wishes first, so the family can stop using the spreadsheet and the note before the rest is built; then reconciliation and reports; the month review last, because it uses both. The entry is large: `plan` may split it into several spec files in this order.
- **Done when:** the family's recurring incomes and expenses are in the app, and the envelopes include Car expenses and Public transport; for the switch-over month the plan's income and costs match the spreadsheet, except where the change of 2026-10-18 differs on purpose (appendix C), as the owner checks on screen (the real figures stay out of the repository, which is public); closing a check-in opens the plan of the month nearest to it, with the expected change and the expected wealth after the month; that month's wishes are on the wishes screen and the shared note is no longer used; a due payment recorded in one tap, and one typed on the Add form on its account, both show it as paid, and the typed one shows the match on its page and in its history, even when its category names a default envelope; typing a payment that is already recorded warns before saving; "Repeat this" on a rent typed before its recurring transaction existed makes it the first payment, with no second one; a wish recorded as an expense, with the paying account picked, shows that expense as spent on it; a plan confirmed after a check-in keeps its record when a wish is added later, and the review shows that wish as a change after recording; on a test data set with known gaps the reconciliation shows the expected unexplained amount for every account, including a cross-currency transfer, a carried-forward balance and an investment account; the parts of REC-4 add up exactly; every report figure opens its transactions; on a test data set with recurring transactions, envelopes and wishes, the month review shows each due payment and envelope expected against actual, the wishes, the unplanned spending, the three figures and the balances of two check-ins; its bridge, starting from the recorded plan, adds up exactly; a carry-over envelope that spent more than its monthly amount but no more than that plus what it carried in shows as within budget, and its part says how much came from the leftover; a yearly bill paid in its due month is shown as expected, not as overspending; and "To improve" names a recurring expense that was over its expected amount in three of the last six months.

### Spec 4: photo reading

- **Goal:** replace typing with photos for receipts and balances.
- **Scope:** PHO, DRF, CHK-11, TXN-11, CAT-8.
- **Depends on:** specs 1 and 2.
- **Trials first:** PHO-1, and the connection from the container to LM Studio.
- **Done when:** the trial result is in the spec; a receipt photographed on an iPhone becomes a draft expense; a bank app screenshot pre-fills a check-in; with LM Studio stopped the app works and says that photo reading is unavailable.

### Spec 5: import API and Apple Pay

- **Goal:** capture card payments as they happen.
- **Scope:** IMP, APL.
- **Depends on:** spec 4.
- **Trials first:** APL-1.
- **Done when:** an Apple Pay payment with a family card produces a draft; sending the same event twice stores one record; a revoked token is rejected; an Apple Pay draft and a typed expense for the same purchase merge into one transaction.

### Spec 6: statement import

- **Goal:** explain the bank accounts completely.
- **Scope:** STM.
- **Depends on:** spec 5.
- **Trials first:** STM-1.
- **Done when:** a real file from each of the four banks imports through the preview; importing it again adds nothing; transfers between the family's accounts are linked; an account that is fully imported shows an unexplained amount of zero for the imported period.

### Spec 7: connectors

- **Goal:** remove typing of balances where a bank allows it.
- **Scope:** CON.
- **Depends on:** spec 5.
- **Trials first:** CON-1 for each connector.
- **Done when:** each connector has passed its trial or was dropped with the reason recorded; balances from a connector appear pre-filled in a check-in; a failing connector shows its last success and blocks nothing.

### Optional: import of the bot's history

- **Scope:** MIG.
- **Depends on:** spec 1, and a copy of the bot's live database from the owner.

## 9. Out of scope

- A native iOS app or anything in the App Store.
- Access from the public internet.
- More than one family, roles, or private accounts.
- Paid services and account aggregators.
- Payments or transfers started from the app.
- A full ledger in which balances are derived from transactions.
- Tracking individual holdings, investment performance, or tax reports.
- Assigning income to envelopes, and limits on categories, recurring transactions or wishes.
- Savings goals with targets, an emergency-fund target, and budgets for one-off projects such as a move: the spreadsheet sections the owner left out on 2026-10-15 (appendix C).
- What-if versions of a month plan.
- Forecasts beyond the month plans, and bill reminders.
- Importing Goodbudget history.
- Telegram.
- Languages other than English.
- Automation for T-Bank.
- Cloud models, or sending financial data or images to any external AI service.
- Work specific to Android.

## 10. Open questions, inputs and host preparation

### 10.1 Open questions and trials

| # | Question | Needed by | How to settle it |
|---|---|---|---|
| 1 | Which free price feeds cover EUR, USD, RUB and the family's coins, with history? | Spec 1 | Trial. Prefer feeds that need no key. Candidates: ECB (no RUB), Bank of Russia, a public coin price API. |
| 2 | Do push notifications arrive reliably in the installed app on the family's iPhones and iPads? | Spec 1 | Trial on the real devices. If not, the in-app banner is the only reminder. |
| 3 | Does Tailscale Serve reach a container port that Rancher Desktop binds to localhost? | Spec 1 | Trial during the deployment task. |
| 4 | Can the container reach LM Studio on the host, and must LM Studio listen on more than localhost for that? | Spec 4 | Trial. |
| 5 | Can the current model read images, and how well does it read German receipts? | Spec 4 | PHO-1. |
| 6 | Can iOS share an image from the share sheet into an installed web app, or does that need a shortcut that posts to the import API? | Spec 4 or 5 | Trial. |
| 7 | What exactly does the Shortcuts Transaction trigger deliver, and how often does it fail? | Spec 5 | APL-1. |
| 8 | What do the statement exports look like, and does Trade Republic's cover the cash account? | Spec 6 | STM-1. |
| 9 | How often does ING ask for approval in its app over FinTS? | Spec 7 | CON-1, after the product ID has arrived. |
| 10 | Does a Wise personal token return balances for an EU account without extra authentication? | Spec 7 | CON-1. |
| 11 | Which chains and coins does the family hold in Trust Wallet? | Spec 1 for the coin list, spec 7 for the connector | Ask the owner. |
| 12 | How are debts entered in the bot today: as negative amounts? | MIG | Ask the owner, and look at the live database. |
| 13 | Should the month review use the calendar month or the period between two check-ins? | Spec 3 | Settled by the owner on 2026-10-18: the calendar month. A closed check-in leads to the plan of the month whose first day is nearest to it (section 4.7). |
| 14 | Should a recurring transaction be able to record its payments by itself (PLN-13)? | Spec 3 | Settled by the owner on 2026-10-18: yes, through a switch on each recurring transaction that is off by default. Otherwise a due payment is recorded in one tap (PLN-12). |

### 10.2 What the owner provides

| Input | Needed by |
|---|---|
| The envelope amounts and current balances from Goodbudget, and a category list | Spec 2 |
| The planning spreadsheet, whose "Мюнхен" tab is the current plan (supplied on 2026-10-15), and the current month's wishes from the shared note. At the switch-over the family enters its recurring incomes and expenses on the Add form, sets up the envelopes Car expenses and Public transport, and adds the month's wishes (appendix C). Neither file goes into the repository. | Spec 3 |
| At least 20 receipt photos and 5 bank app screenshots | Spec 4 |
| One sample statement export each from ING, Revolut, Wise and Trade Republic | Spec 6 |
| A FinTS product ID from Deutsche Kreditwirtschaft. Apply while spec 5 or 6 is being built, because it takes up to two weeks. | Spec 7 |
| A read-only Wise API token, and the public addresses of the crypto holdings | Spec 7 |
| A copy of the bot's live database file. The copy in `~/budget-buddy-bot/data` on the Mac mini is empty. | MIG |

### 10.3 Host preparation by the owner

Done on 2026-10-05:

- The Mac mini never sleeps and restarts after a power failure.
- Automatic login is on, so apps that start at login come back after an outage with nobody at the keyboard. FileVault is off as a result. The disk is therefore not encrypted: the database, images and backups can be read by anyone with physical access to the Mac.

Still to do:

- Make Rancher Desktop and LM Studio, with its local server, start at login.
- Enable MagicDNS and HTTPS certificates for the Tailscale network. Tailscale publishes the machine's host name in public certificate logs, so the name should be neutral.
- Install Tailscale on every family phone and tablet and join them to the same network.

## 11. Defaults chosen without discussion

The owner has not confirmed these. Use them as defaults, and change them if the owner objects.

| Topic | Default |
|---|---|
| Session length | 90 days, renewed on use. |
| Follow-up reminder interval (CHK-3) | Every 2 days. |
| Notification text (NTF-4) | No amounts. |
| Backup copies kept (BKP-1) | 14 daily and 12 monthly. |
| Matching window (section 4.6) | 3 days. |
| Time zone (DEP-9) | Europe/Berlin. |
| Display formats | Dates as DD/MM/YYYY, as in the bot. Amounts as `1,234.56`. |
| Starter categories (CAT-3) | Expense: Groceries, Eating out, Housing, Utilities, Transport, Health, Insurance, Subscriptions, Shopping, Travel, Leisure, Gifts, Fees and taxes, Other. Income: Salary, Other income. |
| Who may manage profiles and the family password (MEM-3) | Every member. |
| Failed sign-ins (SEC-2) | After three wrong passwords, sign-in waits 30 seconds. |
| Sign in again when re-opened (MEM-7, SEC-9) | On for every device, after more than 5 minutes away. The owner's decision of 2026-10-12, not a default. |
| Family password length | At least 10 characters. |
| Revealed home screen amounts (DSH-1) | Hidden again after 30 seconds. |
| Within budget (section 4.4) | A month counts as within budget when its closing balance is zero or more. For a carry-over envelope this includes what was carried in. |
| Category on income (CAT-2) | Optional, as on expenses. |
| Category suggestions from the model (CAT-8) | Shown as suggestions and never applied without a tap. |
| Supported Safari versions (IOS-3) | The current and the previous major version. |
| Sizing (PRF-1) | 3 members, 40 accounts, 10 years, 100,000 transactions, one second per screen. |
| Review month (section 4.8) | The calendar month in the family time zone. Its balances come from the closed check-ins nearest to its first day and to the next month's first day, with a note when either is more than 7 days away. The owner's decision of 2026-10-18 (open question 13), not a default. |
| Plan after a check-in (PLN-8) | The month whose first day is nearest to the closing day: the owner's decision of 2026-10-18. On a tie, the later month: a default the owner confirmed on 2026-10-25. |
| Changing a recurring transaction (TXN-13) | "This and later payments" unless the member picks "This payment only". |
| Schedules (TXN-10) | Every week, 2 weeks, month, 2, 3 or 6 months, or year. A monthly due day that a shorter month lacks falls on its last day. The monthly average of yearly and quarterly bills (PLN-3) is, per currency, each amount divided by its length in months, added up and rounded once. |
| Envelope on a recurring expense (TXN-10) | None: the plan counts the payment on its own, and an envelope would count it twice. |
| Recurring transfers (TXN-10) | Not offered: a transfer moves money between the family's own accounts and changes no figure of the plan. |
| Recorded plan (PLN-19) | Confirmed by a member, or recorded by the app at the end of the month's 7th day: the owner's decision of 2026-10-18. That a record is made once and never again is a default the owner confirmed on 2026-10-25. |
| Matches (section 4.7) | Stored and logged on the transaction, only within the due payment's month, and kept when the recurring transaction changes: the owner's decisions of 2026-10-18. A match that a member undid is never made again: a default the owner confirmed on 2026-10-25. |
| Wish recorded as an expense (PLN-18) | Dated today, with the wish's name as the note. The account is always asked for, never filled in: the owner's decision of 2026-10-18. The wish is ticked off as done unless the member keeps it open. |
| Saving (PLN-5) | No saving line and no put-aside wish: the expected change is what the family means to keep. This was the author's reading of the owner's request of 2026-10-18, confirmed by the owner on 2026-10-25. |
| What counts where (section 4.7) | Envelope first, then a link, then unplanned. The app links a transaction to a due payment it fits: same kind and account, merchant or else category, within 7 days of the due date; nearest date, then nearest amount. The 7-day window is a default the owner confirmed on 2026-10-25. A transaction that fits a due payment gets no envelope from a rule or a default, and the Add form says what it counts for and warns before a payment already recorded is saved again: the owner's decisions of 2026-10-25 (PLN-20). |
| Linked transaction moved to another month (section 4.7) | Its link is removed, whoever made it, and logged; the app tries to match it in its new month. A single payment's due date moves only within its month: to pay it in another month, skip it and add a wish there. |
| Rates for a coming month (section 4.7) | The latest stored rate, marked as estimated, until the month's first day has a rate. A recorded plan keeps the rates it was recorded with; the gap shows as rate differences in the review. |
| Envelope moves and adjustments (ENV-5) | Not in the plan or the review: they move no money, and the spending they make room for already counts. |
| Offline (PLN-21) | The Add form saves as before, without Repeats. Repeats, "Repeat this", recording a due payment, recording a wish and changing wishes need a connection and say so. An expense saved offline is matched when it reaches the server. |
| Carry-over envelopes in the review (section 4.8) | Judged only as ENV-6 does; the bridge keeps the plain monthly difference and notes what came from money carried in; money left in an envelope counts as kept. The owner's decision of 2026-10-25, not a default. |
| Over or under expected (section 4.8) | More than 10% and more than 10 units of the common currency away from the expected amount. |
| Trends (section 4.8) | The last six closed months that have a review; a recurring transaction or an envelope over or under its expected amount in three or more of them; averages rounded to the smallest unit. |
| Small and large unexplained amounts (section 4.8) | Large when above 2% of the month's spending, small otherwise. |
| Spending without a category (section 4.8) | A large share when above 10% of the month's spending. |
| Not paid yet (section 4.8) | Nothing counted by three days after the due date. |
| Record by itself (PLN-13) | Off for every recurring transaction until a member turns it on. The owner's decision of 2026-10-18 (open question 14), not a default. |
| Word for an item of the free-money list | "Wish" in this document. The design chooses the words on screen. |
| Notable additions by the author | TXN-9 (split), TXN-10 (recurring), ENV-5 (adjust and move), STM-8 (generic CSV), APL-5 (automatic confirmation), SUM-5 and SUM-6 (extra summary content), CHK-3 (follow-up reminders), DSH-3 (stale balances). On 2026-10-15: PLN-11 (move a wish), PLN-12 and PLN-13 (record a payment), PLN-14 (what a transaction counts for), PLN-15 (progress during the month), PLN-16 (keep the expression), DSH-5 (free money on Home), REV-7's "To improve", REV-8 (apply a suggestion), REV-10 (year view), REV-11 (notification) and REV-12 (CSV). On 2026-10-18: TXN-12 (the recurring list), the 7-day fit of a typed payment (section 4.7), the monthly average of yearly bills (PLN-3), the expected wealth after the month (PLN-8), and the due payments on Home (DSH-5). |

## Appendix A: what the bot does and where it went

Every capability of the bot was read from its code on 2026-10-05.

| Bot capability | Requirement |
|---|---|
| `/start`: any member starts a count at any time; others join the open one | CHK-1 |
| Other members are told when a count starts | CHK-4 |
| Accounts are asked one by one, showing the previous value | CHK-5 |
| "Unchanged" button keeps the previous value | CHK-5 |
| "Back" button to correct an earlier answer | CHK-7 |
| Arithmetic in answers, with brackets and percent | ACC-9 |
| An invalid value is rejected and asked again | ACC-9 |
| A member already in a count is returned to it | CHK-6 |
| A member without accounts is told to create one | CHK-12 |
| A member closes the count with "Close now"; the last value does not close it | CHK-8 |
| On closing every member gets the summary, with a chart button | CHK-9, SUM-1 |
| `/summary`: totals per currency | SUM-2, DSH-1 |
| Equivalent in a chosen currency (an environment variable in the bot) | SUM-3, CUR-1 |
| Comparison with the previous count: old value, difference, direction | SUM-2, SUM-3 |
| Line chart of the equivalent over all counts, switchable to one currency | SUM-4 |
| `/vaults`: a member's active accounts with their latest amounts | ACC-3 |
| `/create`: a new account with a name and a validated currency | ACC-1, ACC-10 |
| `/edit`: rename | ACC-4 |
| `/edit`: change currency | ACC-5 |
| `/edit`: change the current value | ACC-6, ACC-7 |
| `/edit`: deactivate, with confirmation | ACC-4 |
| Deactivated accounts leave new counts but stay in history | Section 4.3 |
| Cash and debts logged as accounts | ACC-2, section 4.2 |
| Several members share one budget | MEM-4 |
| Script that imports history from a spreadsheet export | MIG |

Deliberate differences from the bot:

- The bot converts all history at today's rate. The app uses each date's rate and offers today's rates as a switch (CUR-6).
- In the bot a member sees only their own accounts. In the app everyone sees all accounts (MEM-4).
- The bot is in Russian. The app is in English.
- A count in the bot stays open until every member has answered, and unfinished answers are lost on a restart. The app saves each value at once (CHK-6) and lets any member close a check-in (CHK-8).
- The bot has no way to add a member or reactivate an account. The app has both (MEM-3, ACC-4).

## Appendix B: sources

- [ING: FinTS/HBCI help](https://www.ing.de/hilfe/log-in/fints/)
- [python-fints: getting started](https://python-fints.readthedocs.io/en/latest/quickstart.html)
- [Wise: personal tokens](https://docs.wise.com/api-docs/features/authentication-access/personal-tokens)
- [Revolut community: API without a business account](https://community.revolut.com/t/api-without-business-account/42364)
- [mobiflip: Trade Republic export function](https://www.mobiflip.de/trade-republic-bekommt-neue-export-funktion-und-outbank-zieht-sofort-nach/)
- [pytr on GitHub](https://github.com/pytr-org/pytr)
- [Apple Developer Forums: Transaction trigger timeouts](https://developer.apple.com/forums/thread/765516)
- [Actual Budget docs: GoCardless accepts no new accounts](https://actualbudget.org/docs/advanced/bank-sync/gocardless/)
- [ECB: euro foreign exchange reference rates](https://www.ecb.europa.eu/stats/eurofxref)

## Appendix C: the planning spreadsheet and the note, and where they went

Read from the "Мюнхен" tab of the family's spreadsheet on 2026-10-15. The figures are left out on purpose, because this repository is public.

| Spreadsheet part | In the app | Requirement |
|---|---|---|
| "Доходы" (income): one line per adult. One salary is typed as a sum of two parts; the other line is at zero. | A monthly recurring income per salary, naming the member and the Salary category. The line at zero needs none. | TXN-10, PLN-16 |
| "Ежемесячные расходы" (monthly costs): rent, utilities (two parts), a parking space, internet, mobile for two, two streaming subscriptions, fitness for two (two memberships), a haircut, public transport for two, the broadcasting fee, diesel, and work software at zero. | Monthly recurring expenses with their account, category and merchant; the haircut is one of them, at a fixed amount. Diesel becomes the envelope Car expenses, and public transport the envelope Public transport (owner, 2026-10-18). Work software at zero needs none. | TXN-10, PLN-1, PLN-4 |
| Groceries, café and unexpected costs, among the monthly costs. | The envelopes Groceries, Eating out and Unexpected. The plan takes their monthly amounts from the envelopes, so the two must agree at the switch-over. | PLN-4 |
| "Накопления" (savings), among the monthly costs. | Nothing to enter: the plan's expected change is what the family keeps, and the review checks it (section 4.8). | PLN-5 |
| "Ежегодные расходы" (yearly costs): two insurances, car tax, car insurance and cloud storage, some with a payment date. | Recurring expenses repeating every year from their next payment date, counted in full in the month they are due. | TXN-10, PLN-3 |
| "Помесячно": the yearly total divided by 12 and added to the monthly costs. | The monthly average of the yearly bills, shown for information and not counted (owner, 2026-10-18). | PLN-3 |
| "Итого" (total) and "Остаток" (remainder). | Expected costs and free money, then the expected change after the wishes. | PLN-2 |
| The shared Apple Note of what to do with the remainder. | Wishes, on their own screen. | PLN-9 to PLN-11 |
| Nothing: the spreadsheet does not compare the plan with what happened. | The month review. | REV |

Not taken over, by the owner's decision of 2026-10-15 (section 9): "Финансовая подушка" (an emergency-fund target), "Цели" (savings goals with targets) and "Переезд" (a one-off budget for the move).

Notes for the switch-over:

- The broadcasting fee is in the spreadsheet as a monthly amount. If the family pays it every three months, a recurring expense every 3 months matches the bank better. As a monthly one, the review would show it unpaid in two months out of three.
- The starter categories (section 11) have no obvious home for the haircut or the parking space. The family picks one or adds a category (CAT-1).
- Expressions such as "282 + 75" can be typed into the amount fields as they are (ACC-9).
- Set each recurring transaction's due day to the day its money usually goes out or comes in, so that the payment falls in the same month as its due date (section 4.7). A salary paid at the end of the previous month is due on that day, not on the 1st.
- The free money will not equal the spreadsheet's remainder, on purpose: yearly bills count in full in their due month instead of a twelfth every month, and savings are not a cost. Diesel and public transport come in through their envelopes' monthly amounts.
