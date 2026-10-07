# Budget Buddy: product requirements

Status: approved by the owner on 2026-10-05. Amended on 2026-10-06 after the prototype review: sign-in with a family password and profiles, the private home screen, and how category and envelope are filled in (section 3, MEM, DSH-1, DSH-4, CAT-1, CAT-5, SET-1, section 11). This document is the input for the `plan` agent. It is not a spec and contains no task list.

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

A family of two or three adults in Germany holds money in about 20 accounts (7 to 10 per person) in euros, US dollars, Russian rubles and crypto. They use two tools today:

- **budget-buddy-bot** is a self-made Telegram bot (`~/budget-buddy-bot`; TypeScript, Prisma, SQLite). About once a month it asks every member for the balance of each of their accounts. It then reports the family total per currency and the equivalent in euros, with history charts. Cash and debts are logged as accounts.
- **Goodbudget** is an iPhone app. The family logs every expense in it against three envelopes that are topped up monthly: Groceries, Eating out and Unexpected.

What is wrong with this setup:

- The bot is limited: weak statistics and clumsy account management.
- Typing about 20 balances every month is tedious.
- Typing every expense is tedious, and many expenses are paid in cash.
- Nothing connects the two tools, so the family cannot check that what they spend matches what their balances show.

The goal is one self-hosted web app, used mainly on iPhone and iPad, that replaces both tools, reduces typing, and shows each month how much of the change in balances is explained by recorded income and spending.

The product is successful when:

- the family stops using the bot after spec 1 and Goodbudget after spec 2;
- a check-in needs no typing for an account whose balance did not change;
- an expense can be saved after entering only an amount;
- each month the app shows one unexplained amount per account and one for the family;
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
| Budgeting | Only envelopes have limits. Categories have none, and income is not assigned to envelopes. | Planning every category each month is unwanted. |
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

Reports (RPT) use calendar months and convert each transaction at the rate of its own date. The reconciliation uses check-in periods and the closing rate. Their figures differ slightly by design.

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

## 5. Functional requirements

### MEM: members and sign-in (spec 1)

- **MEM-1 (Must).** On first start, when no member exists, the app shows a setup screen that sets the family password and creates a profile for each member, at least one.
- **MEM-2 (Must).** A device signs in with the family password and then opens a profile: the device's default profile, or one the member picks, optionally remembered as the default. A signed-in member can switch to another profile and set or clear the device's default profile at any time. The device stays signed in until it signs out or the session expires.
- **MEM-3 (Must).** Any signed-in member can add a profile, rename one, and deactivate or reactivate one. A deactivated profile cannot be opened. Its accounts and history stay. Any signed-in member can change the family password, which signs out every other device.
- **MEM-4 (Must).** Every member can see and change all data. There are no roles and no private accounts.
- **MEM-5 (Must).** Every snapshot, transaction and envelope adjustment stores who created it, who last changed it, and when. A corrected balance keeps its previous values in a change history.
- **MEM-6 (Could).** A device can be unlocked with a passkey (Face ID or Touch ID) instead of the family password.

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
- **CHK-2 (Must).** Settings hold one check-in cadence for the family: off, monthly on a chosen day of the month, or every N weeks on a chosen weekday, each with a time of day. At that moment the app opens a check-in if none is open and reminds every active member (NTF-2).
- **CHK-3 (Should).** While a check-in is open, each member who still has accounts without a value gets a follow-up reminder at an interval set in settings.
- **CHK-4 (Must).** When a member starts a check-in by hand, the other members are notified and told who started it.
- **CHK-5 (Must).** The check-in screen shows all active accounts of the signed-in member on one screen, each with its name, currency, last balance and the date of that balance. For each account the member either taps "unchanged" (labelled "Same" in the design) or enters a new amount (ACC-9). "Unchanged" stores a fresh snapshot equal to the previous balance; only an account left without a value is carried forward (CHK-8). The member can switch to another member's accounts and fill those in too.
- **CHK-6 (Must).** Each value is saved on the server as soon as it is entered. An open check-in survives a restart of the app or the server and can be continued on another device.
- **CHK-7 (Must).** A value can be changed until the check-in closes. After that it is corrected through ACC-7.
- **CHK-8 (Must).** The check-in closes by itself when every active account of every member has a value. Any member can also close it earlier. Each account without a value then gets its previous balance, marked as carried forward.
- **CHK-9 (Must).** When a check-in closes, every member is notified, and the notification opens the summary page (SUM-1).
- **CHK-10 (Should).** The check-in shows progress: which members have finished and how many accounts are still open.
- **CHK-11 (Must, from spec 4).** An account that received a fresh balance from a connector, a statement or a confirmed photo draft since the check-in opened is shown pre-filled and marked with its source. The member only confirms it.
- **CHK-12 (Must).** A member with no active accounts sees a prompt to create one instead of an empty check-in.

### SUM: check-in summary (spec 1)

- **SUM-1 (Must).** Every closed check-in has a summary page, shown right after closing. A list of past check-ins leads to each one. Summary pages are computed from the stored data, so a later correction shows up in them.
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
- **NTF-2 (Must).** The installed app receives push notifications on iOS through Web Push (iOS 16.4 or later). Each device opts in from settings, following a tap, as iOS requires. The events are: scheduled check-in, check-in started by a member, follow-up reminder, and check-in closed.
- **NTF-3 (Must).** The app works fully without push permission.
- **NTF-4 (Must).** Notification texts contain no amounts.
- **NTF-5 (Should, later specs).** Further events: drafts waiting, a connector failing, an envelope overspent.

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
- **TXN-10 (Should).** A recurring transaction, such as rent, a subscription or a salary, is defined once with a schedule and creates a transaction each period.
- **TXN-11 (Should; Must from spec 4).** An image can be attached to a transaction.

### CAT: categories (spec 2)

- **CAT-1 (Must).** Members manage a flat list of categories. Each is either an expense category or an income category. It may name a default envelope, which is filled in when an expense with this category is saved without an envelope (CAT-5). A category with transactions can be renamed or archived, not deleted.
- **CAT-2 (Must).** A category is optional on an expense and on an income. A transaction without one is confirmed like any other, and reports show it under "Uncategorised". A split transaction can have one category per part.
- **CAT-3 (Must).** First start offers a starter list of categories that the family can edit.
- **CAT-4 (Could).** Categories can be merged, and grouped one level deep.
- **CAT-5 (Must).** While a member enters an expense or an income, a rule that matches the merchant (CAT-6) pre-selects its category and envelope, in fields the member has not set by hand. Otherwise the app offers one-tap category suggestions: the categories used most often with the same merchant, with the chosen envelope, and by this member recently. During entry, category and envelope do not fill each other. On saving, an empty envelope takes the category's default envelope (CAT-1) and an empty category takes the envelope's default category (ENV-1), and the confirmation says what was filled in. The member can change either field or leave it empty; to keep an expense out of every envelope despite a default, the member clears the envelope on the saved transaction.
- **CAT-6 (Must).** A rule maps a merchant text pattern, optionally limited to one account, to a category and an envelope. When a member sets or changes the category of a transaction that has a merchant, the app offers to save that as a rule. Rules can be listed, edited, ordered and deleted in settings.
- **CAT-7 (Must).** Transactions without a category are collected in a list for later labelling. Each shows a suggested category that is applied with one tap, and several can be labelled at once.
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
- **COR-3 (Must).** Every scheduled job (top-ups, rates, backups, reminders, connectors) can run twice without doing its work twice, and makes up for a run it missed while the server was off.
- **COR-4 (Must).** A total shown on a screen equals the sum of the parts shown with it.
- **COR-5 (Must).** Accounts, categories, envelopes and members that have history are archived, never deleted.

### 6.5 PRF: performance

- **PRF-1 (Must).** The app is sized for one family: 3 members, 40 accounts, 10 years of history and 100,000 transactions. At that volume every screen answers within one second on the host.
- **PRF-2 (Must).** Slow work (model calls, imports, backups) runs in the background and never blocks a request.

### 6.6 QUA: quality

- **QUA-1 (Must).** The definition of done in `AGENTS.md` applies to every task.
- **QUA-2 (Must).** End-to-end tests run in the WebKit engine at iPhone and iPad sizes, because Safari is the target.
- **QUA-3 (Must).** Unit tests cover the money logic with these edge cases: rounding, negative balances, missing rates, month ends, leap years, daylight-saving changes, cross-currency transfers, carried-forward snapshots, and jobs run twice or late.

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
- **Done when:** the three envelopes exist with the balances taken over from Goodbudget; an expense typed without a connection arrives exactly once after reconnecting; a month change tops up one carry-over envelope and one reset envelope correctly, also when the server was off on the 1st; after that change both envelopes show the closed month's closing balance and whether it stayed within budget; an expense saved with only an amount is listed for labelling with a suggested category.

### Spec 3: reconciliation and reports

- **Goal:** show where the money went and whether any is unaccounted for.
- **Scope:** REC, RPT, SUM-7.
- **Depends on:** specs 1 and 2.
- **Done when:** on a test data set with known gaps the reconciliation shows the expected unexplained amount for every account, including a cross-currency transfer, a carried-forward balance and an investment account; the parts of REC-4 add up exactly; every report figure opens its transactions.

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
- Assigning income to envelopes, savings goals, forecasts and bill reminders.
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

### 10.2 What the owner provides

| Input | Needed by |
|---|---|
| The envelope amounts and current balances from Goodbudget, and a category list | Spec 2 |
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
| Family password length | At least 10 characters. |
| Revealed home screen amounts (DSH-1) | Hidden again after 30 seconds. |
| Within budget (section 4.4) | A month counts as within budget when its closing balance is zero or more. For a carry-over envelope this includes what was carried in. |
| Category on income (CAT-2) | Optional, as on expenses. |
| Category suggestions from the model (CAT-8) | Shown as suggestions and never applied without a tap. |
| Supported Safari versions (IOS-3) | The current and the previous major version. |
| Sizing (PRF-1) | 3 members, 40 accounts, 10 years, 100,000 transactions, one second per screen. |
| Notable additions by the author | TXN-9 (split), TXN-10 (recurring), ENV-5 (adjust and move), STM-8 (generic CSV), APL-5 (automatic confirmation), SUM-5 and SUM-6 (extra summary content), CHK-3 (follow-up reminders), DSH-3 (stale balances). |

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
| The count completes when every active account has a value | CHK-8 |
| On completion every member gets the summary, with a chart button | CHK-9, SUM-1 |
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
