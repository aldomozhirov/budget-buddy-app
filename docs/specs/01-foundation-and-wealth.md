# Spec 01: Foundation and wealth

Status: written by `plan` on 2026-10-06, settled with the owner the same day. Roadmap entry: spec 1 in `docs/requirements.md` section 8. Built by `build` one task at a time, in order, unless a task is marked as parallel.

Inputs: `AGENTS.md`, `docs/requirements.md` (amended 2026-10-06), `docs/design-spec.md`, `docs/design/html/` (`bb.css`, `styleguide.html`, `screens/`), `docs/design/prototype/`.

## Goal

The family stops using the Telegram bot. On the Mac mini, reachable only through Tailscale, the app lets each member sign in with the family password and a profile, keep the family's accounts and their balances, and run the regular check-in from an iPhone or iPad. A scheduled check-in opens by itself and is announced with a push notification. Members fill in their balances with "Same" or a typed amount, any member can close the round, and the summary then shows the family total per currency and in euros, compared with the previous check-in, with a chart over all check-ins. Home shows one wealth figure, hidden until revealed. Rates are fetched daily from free public feeds, the data is backed up every night, and a backup can be restored into a fresh container.

## Decisions taken with the owner for this spec

| # | Topic | Decision |
|---|---|---|
| D1 | Stack | pnpm workspace; Vue 3 + Vite + Vue Router + `vite-plugin-pwa`; `bb.css` ported as plain CSS with no UI library; hand-built SVG charts; Fastify + zod; SQLite through `better-sqlite3` + Drizzle ORM with `drizzle-kit` migrations; argon2id; `web-push`; Vitest; Playwright on WebKit. Details are in Design, section 1. |
| D2 | Home | Spec 1 builds only the parts of Home that spec 1 can fill: greeting, eye button, avatar, check-in banner, the Check-in tile, the Family wealth card and the "Everything" grid with the screens that exist. Add expense, the Income and Transfer tiles, the envelopes card and "Needs a category" arrive in spec 2, in the same layout (UI-HOME-1). |
| D3 | Wealth history (DSH-2) | **Moved to spec 3**, to be designed and built together with RPT-4. Until then Home's "Wealth history" link opens the latest check-in summary, as `design-spec.md` section 2 allows. This changes a spec-1 Must, so the owner must confirm it again when spec 3 is planned. |
| D4 | Face ID unlock (MEM-6, UI-AUTH-7) | **In spec 1**, implemented as a passkey on the device (task 29). |
| D5 | Follow-up reminders (CHK-3) | **In spec 1** (task 26). |
| D6 | Manual rate entry (CUR-5) | **Moved to a later spec.** Settings shows the rates' status but cannot edit them. |
| D7 | Spec shape | One file, five milestones. Each milestone ends in something the owner can try. |
| D8 | Data sources of an account | An account can be fed by several sources at once (by hand, check-in, photo, statement, connector). The source is stored on each record, never on the account: `account.data_source` is dropped. How an account is covered (REC-8) is derived from its records. Outside identifiers (IBAN, Wise balance ID, crypto address, card name, screenshot label) go into one `account_link` table, added by the first spec that imports data (Design, section 4.1). This replaces the free-text `bank_ids` column. |

Requirement changes to report to the owner: D3 (DSH-2 deferred), D6 (CUR-5 deferred) and D8 (an account has no single data source, unlike requirements 4.1). `plan` cannot edit `requirements.md`, so they are recorded here.

## Out of scope

- Everything in specs 2 to 7: transactions, categories, envelopes, rules, reconciliation, reports, photo reading, the import API, Apple Pay, statement import and connectors. SUM-7, CHK-11, DSH-4 and NTF-5 are left out too.
- Wealth history (DSH-2) and manual rates (CUR-5), per D3 and D6.
- Importing the bot's history (MIG).
- Every Home element that belongs to spec 2 (D2), and the "Spending" section of Settings.
- The `account_link` table and the "Bank IDs" field of account settings (UI-ACC-3). Both arrive with the first spec that imports data (D8).
- Undesigned screens other than the small editors this spec has to add (coin list, common currency, time zone). Those follow existing `bb.css` patterns: a list card and a bottom sheet.

## Settled open items

On 2026-10-07 the owner accepted every default below. They are decisions now; the "Needed by" column says which task applies each one.

| # | Item | Decision | Needed by |
|---|---|---|---|
| O1 | Which coins and chains does the family hold (requirements 10.1 #11)? | Seed the coin list with BTC, ETH and USDT. Members can edit it in Settings. | Task 11 |
| O2 | Home wealth figure. The prototype shows the latest check-in's total next to "+€1,742 since check-in of 02/09/2026", while DSH-1 says "current wealth … with the change since the previous check-in". These don't agree. | Current wealth: the latest balances at the latest rates, with the change against the latest closed check-in's equivalent and that check-in's date. Copy: "+€1,742 since check-in of 02/09/2026". | Task 23 |
| O3 | What `%` means in the amount expression (ACC-9). The bot's code was not available while this spec was written. | Postfix percent divides by 100, so `200 * 10%` = 20 and `100 + 10%` = 100.1. This matches the example in ACC-9. | Task 3 |
| O4 | App icon for the Home Screen. | A plain mark: "BB" in Geist 700, `on-ink` on an `ink` square. The owner may replace it later. | Task 27 |

## Design

### 1. Stack and repository layout

```
/                       pnpm workspace root
  package.json          scripts: dev, build, typecheck, lint, test, e2e, format
  pnpm-workspace.yaml
  .nvmrc                24
  .env.example
  compose.yaml
  Dockerfile
  README.md             install, update, restore, host preparation (DEP-7)
  shared/               TypeScript library used by web and server; no I/O
    src/money/          currencies, Money, rounding, formatting, expression evaluator
    src/time/           calendar dates, configured time zone, display formats
    src/api/            zod schemas and types for every request and response
  server/               Fastify API, scheduled jobs, static serving of web/dist
    src/db/             Drizzle schema, migrations, connection, backup
    src/modules/<name>/ routes + service + repository per module
    src/jobs/           job runner and the jobs
    src/rates/          feed interface and feeds
    test/               Vitest unit and integration tests, fixtures
  web/                  Vue 3 app
    src/styles/         bb.css port, Geist font files
    src/components/     design-system components
    src/screens/        one folder per screen
    src/router/         routes, guards, back-navigation history
    src/stores/         small reactive stores (session, device, prefs); no Pinia unless a task needs it
    e2e/                Playwright tests
```

| Concern | Choice | Notes |
|---|---|---|
| Node | 24 LTS | `engines` and `.nvmrc`. |
| Package manager | pnpm | Lockfile committed; `--frozen-lockfile` in Docker and CI. |
| Language | TypeScript, `strict`, `noUncheckedIndexedAccess` | Shared `tsconfig.base.json`. |
| Web | Vue 3 (`<script setup>`), Vite, Vue Router 4 | Only in-house components. Icons from `lucide-vue-next`, bundled (UI-VIS-6). |
| PWA | `vite-plugin-pwa` (injectManifest, own service worker) | The service worker handles precaching, push and notification clicks. |
| API | Fastify 5, `fastify-type-provider-zod` | JSON only. Every input validated with zod from `shared/src/api` (SEC-4). |
| DB | SQLite (WAL) through `better-sqlite3`; Drizzle ORM; `drizzle-kit` for SQL migrations | `better-sqlite3`'s `.backup()` gives SQLite's online backup (BKP-1). Money columns are read with `safeIntegers` so they arrive as BigInt. |
| Decimals | `decimal.js` | Only for rates and conversion. Stored amounts are integers (section 3). |
| Dates | `date-fns` + `@date-fns/tz` | Shared by web and server. |
| Passwords | `@node-rs/argon2` (argon2id, m = 19 MiB, t = 2, p = 1) | Prebuilt for linux/arm64 and macOS. |
| Passkeys | `@simplewebauthn/server` + `@simplewebauthn/browser` | Task 29. |
| Push | `web-push` with VAPID keys generated at first start into the data directory | |
| Zip export | `fflate` | |
| Logging | Fastify's pino logger with redaction | SEC-6. |
| Unit tests | Vitest | In `shared`, `server` and `web`. |
| E2E | Playwright, **WebKit only**, at iPhone 390 × 844 and iPad 820 × 1180 | QUA-2. Runs against a production build with a fixture rate feed and a temporary data directory. |
| Lint | ESLint (flat config, `typescript-eslint`, `eslint-plugin-vue`), Prettier | |

Choosing a package's version: use the latest stable release when the task starts, pin it in the lockfile, and record the major versions in `AGENTS.md` (task 2).

### 2. Runtime architecture

- One Node process serves the API under `/api`, the built web app as static files, and the scheduled jobs. One container, one image (DEP-1).
- Data directory `DATA_DIR` (default `/data`) holds `budget-buddy.sqlite`, `keys/` (VAPID, session secret) and `images/` (empty in spec 1). Backups go to `BACKUP_DIR` (default `/backups`), a second mounted folder on the host (DEP-2, BKP-1).
- A `Clock` interface (`now(): Date`) is passed to every service and job. Tests use a fake clock. Nothing calls `Date.now()` directly outside the clock.
- A `RateFeed` interface is passed to the rates service (CUR-7). In tests and E2E, `RATES_FEED=fixture` replaces every feed with fixtures.
- A `PushSender` interface wraps `web-push`. Tests use a recording fake.

### 3. Money, rates and time (requirements 4.2, COR-1, COR-2)

- **Currencies.** `shared/src/money/iso4217.ts` is a bundled table of ISO 4217 codes with their minor units and names. Coins live in the database (`coin` table) with their decimals; the cap is 8 (rule 4.2.1). A currency's symbol comes from `Intl.NumberFormat('en', {style:'currency', currencyDisplay:'narrowSymbol'})`, falling back to the code. Coins use a symbol from a small table (BTC ₿, ETH Ξ) or else the ticker.
- **Amounts** are `bigint` minor units in code, `INTEGER` in SQLite, and decimal-integer strings in JSON (`"-198630"`), validated by `/^-?\d{1,20}$/`. Floating point is never used for money. A lint rule bans `parseFloat` and `Number(` in `shared/src/money` and in the server's money paths.
- **Rounding.** One function, `roundHalfAwayFromZero(decimal, decimals): bigint`, is used everywhere.
- **Formatting** (UI-TXT-2): `€1,234.56`, the currency's own decimals, minus as U+2212 (`−€14.50`), changes as `▲ €1,742.00`, `▼ ₽4,700.00` or `Unchanged`. Dates `DD/MM/YYYY` (UI-TXT-1).
- **Expression evaluator** (ACC-9, UI-AMT-2): a tokenizer and recursive-descent parser over `digits . + − - × * ÷ / ( ) %`, evaluated in `decimal.js`. Unary minus is allowed at the start and after `(`. `%` is postfix ÷100 (O3). It returns `{ok: true, value: bigint}` after rounding to the currency's decimals, or `{ok: false, reason}` for empty input, unbalanced brackets, a trailing operator, division by zero or overflow. `lastCompleteValue(expr)` gives the result shown while an operator is still open. The server never evaluates expressions: it receives minor units and validates them.
- **Rates** are stored as exact decimal strings per (`base`, `quote`, `date`). Each feed stores rates against its own pivot (for example EUR→USD from the ECB, RUB per EUR from the Bank of Russia, coin→EUR or coin→USD from the coin feed). `convert(amount, from, to, date)` finds a path through the stored pairs (direct, inverse, or through one pivot), using for each pair the rate of `date` or of the nearest earlier date (rule 4.2.4). It computes in `decimal.js` with 34 significant digits and rounds once at the end. It returns `{value, rateDate}`, or `missing` when no rate exists on or before the date. Missing rates are shown, never guessed: the figure becomes "Rate missing" and the total says it is incomplete.
- **Totals across currencies** (rule 4.2.5): sum each currency in its own unit, convert each currency total, then add.
- **Time.** A snapshot carries an instant (`taken_at`, UTC epoch milliseconds). "Today", schedules and the 00:00 of a date are computed in the configured time zone (DEP-9, default `Europe/Berlin`). A snapshot given only a date (opening balance, "Earlier date…") gets the end of that day in the configured time zone; a date of today gets the current instant.

### 4. Data model

All tables have `id INTEGER PRIMARY KEY`, unless stated otherwise. Foreign keys are on (`PRAGMA foreign_keys = ON`). `*_by` columns reference `member.id`. Constraints live in the schema, not only in code.

| Table | Columns | Constraints and notes |
|---|---|---|
| `family` (one row) | `password_hash`, `password_epoch INTEGER`, `common_currency`, `time_zone`, `cadence_kind` (`off`/`monthly`/`weeks`), `cadence_day_of_month` (1–28 or `last`), `cadence_every_weeks` (1–8), `cadence_weekday` (1–7), `cadence_time` (`HH:MM`), `cadence_anchor_date`, `followup_days` (0 = off, default 2), `failed_signins INTEGER`, `locked_until`, `created_at` | `CHECK (id = 1)`. `password_epoch` is incremented when the password changes. |
| `member` | `name`, `active`, `created_at`, `deactivated_at` | `name` unique among active members, case-insensitive. Never deleted (COR-5). |
| `device` | `id TEXT` (random 128-bit, in cookie `bb_device`), `default_member_id`, `hide_home_amounts` (default 1), `label` (from the user agent), `created_at`, `last_seen_at` | One row per browser or installed app. |
| `session` | `token_hash TEXT` (SHA-256 of the cookie value), `device_id`, `member_id` (profile in use, nullable until picked), `password_epoch`, `created_at`, `last_used_at`, `expires_at` | 90 days, extended on use (requirements section 11). Invalid when `password_epoch` differs from `family.password_epoch`. |
| `passkey` | `device_id`, `credential_id` (unique), `public_key`, `counter`, `created_at` | Task 29. |
| `push_subscription` | `device_id`, `member_id`, `endpoint` (unique), `p256dh`, `auth`, `created_at`, `last_success_at`, `failures` | `member_id` is the profile the device opened as when it opted in, updated when the device's profile changes. |
| `coin` | `code TEXT PRIMARY KEY`, `name`, `decimals` (0–8), `feed_id`, `created_at` | `code` must not clash with ISO 4217. |
| `account` | `name`, `owner_member_id`, `type` (`bank`/`cash`/`investment`/`crypto`/`we_owe`/`owed_to_us`), `currency`, `active`, `deactivated_at`, `created_by`, `created_at`, `updated_by`, `updated_at` | `CHECK` on `type`. `currency` is an ISO code or a `coin.code`, validated in the service. No source column (D8). |
| `snapshot` | `account_id`, `taken_at`, `amount INTEGER`, `source` (`opening`/`manual`/`checkin`/`carried_forward`/`photo`/`statement`/`connector`), `checkin_id` (nullable), `source_ref` (nullable: which connector, statement parser or import token, for example `connector:wise`), `external_id` (nullable: the source's own ID for the record), `created_by`, `created_at`, `updated_by`, `updated_at` | `UNIQUE (checkin_id, account_id)` where `checkin_id` is not null. `UNIQUE (source_ref, external_id)` where both are not null, so an import sent twice stores one snapshot (IMP-1). `CHECK`: `external_id` requires `source_ref`. Index `(account_id, taken_at DESC)`. `carried_forward` requires `checkin_id`. Spec 1 leaves `source_ref` and `external_id` empty. |
| `snapshot_revision` | `snapshot_id` (no FK, so it survives deletion), `account_id`, `action` (`update`/`delete`), `old_amount`, `old_taken_at`, `changed_by`, `changed_at` | MEM-5 change history. |
| `checkin` | `opened_at`, `opened_by` (null when the schedule opened it), `schedule_slot` (nullable, unique), `closed_at`, `closed_by` (null when it closed by itself) | Partial unique index: at most one row where `closed_at IS NULL` (CHK-1). |
| `rate` | `base`, `quote`, `date` (`YYYY-MM-DD`), `rate TEXT`, `source`, `fetched_at` | `UNIQUE (base, quote, date)`. Never deleted (CUR-2). |
| `rate_fetch` | `feed_id`, `date`, `status`, `error`, `at` | Feeds the "Updated today 06:00" and stale-rate display (CUR-4). |
| `job_run` | `job`, `slot TEXT`, `status` (`running`/`done`/`failed`), `started_at`, `finished_at`, `error` | `UNIQUE (job, slot)`. A job inserts its slot before working, so a second run of the same slot does nothing (COR-3). |
| `notification` | `event`, `checkin_id`, `member_id`, `slot TEXT`, `sent_at` | `UNIQUE (event, checkin_id, member_id, slot)`, so no notification is sent twice. |
| `backup` | `kind` (`daily`/`monthly`/`pre_migration`), `path`, `bytes`, `started_at`, `finished_at`, `status`, `error` | BKP-4 status. |

#### 4.1 Later: `account_link` (not built in spec 1)

Recorded here so later specs extend the model the same way. The first spec that imports data (spec 4, 5 or 6, whichever comes first) adds:

| Table | Columns | Constraints and notes |
|---|---|---|
| `account_link` | `account_id`, `kind` (`iban`/`wise_balance`/`crypto_address`/`card_name`/`screenshot_label`/…), `value`, `source_ref` (nullable: the connector or parser that uses it), `active`, `created_by`, `created_at`, `last_seen_at` | `UNIQUE (kind, value)`: one outside identifier points to one account. An account can have any number of links. |

It serves the transfer recognition of STM-5, the card mapping of APL-3, the remembered screenshot names of PHO-3 and the account IDs a connector returns (CON). Coverage for REC-8 ("connector, last balance yesterday", "statements up to 30/09/2026") is computed from snapshots and transactions by `source` and `source_ref`, not stored.

### 5. Domain rules this spec adds or makes concrete

- **Balance at T** (requirements 4.3): the latest snapshot of the account with `taken_at ≤ T`, zero before the first snapshot and zero from `deactivated_at` on. One function, `balanceAt(accountIds, T)`, used by every screen and by the summary.
- **Several sources, one balance** (D8). Snapshots from every source compete only by `taken_at`; the newest wins, whoever wrote it. When two snapshots of an account have the same `taken_at`, the source order decides: `connector`, `statement`, `photo`, `checkin`, `manual`, `opening`, `carried_forward`, then the higher `id`. The bank's own figure therefore beats a typed one at the same instant, and a carried-forward value never hides a fresh one. `balanceAt` and every "latest balance" query use this one ordering.
- **Who is in a check-in.** An account needs a value when it is active right now. An account created while a check-in is open joins it; an account deactivated while it is open leaves it. Accounts of a deactivated profile stay in check-ins under that profile's tab, with "(inactive)" after the name, because their accounts stay active until someone deactivates them.
- **"Same"** (UI-CHK-4) stores a `checkin` snapshot whose amount equals the account's balance just before this check-in's value. Saving a value again replaces the amount of the same snapshot (CHK-7); the old value goes to `snapshot_revision`.
- **Closing** (CHK-8). The check-in closes by itself in the same transaction that stores the last missing value. "Close now" stores a `carried_forward` snapshot, at the close instant, for each account without a value. `closed_at` is the instant of the close. After closing, its values change only through account history (ACC-7), which writes revisions.
- **Check-in value instants.** A check-in value's `taken_at` is the moment it was last saved. Like every snapshot it competes with the others by `taken_at` and the source order above.
- **Currency change** (ACC-5) relabels without converting. If the decimals differ, the stored integers are rescaled so the shown number stays the same (`€19.86` becomes `¥20` with rounding half away from zero). The confirmation sheet shows an example from the account's own latest balance, and lists the amounts that would lose precision when there are any.
- **Stale** (DSH-3): a balance is stale when the cadence is not `off` and `taken_at` is older than one cadence period (one month for monthly, N weeks for every N weeks) before now.
- **Schedule slots.** The cadence gives a sequence of local date-times. The slot key is that local time in ISO form, for example `2026-11-05T09:00`. A time that does not exist because of a daylight-saving change runs at the first valid minute after it; a time that exists twice runs once.

### 6. Summary computation (SUM-2, SUM-3, SUM-5, SUM-6; COR-4)

For the closed check-in `C` (closed at `T1`, rates of the date `d1` in the configured time zone) and the previous closed check-in `P` (`T0`, `d0`):

1. For every account active at `T0` or `T1`: `o = balanceAt(T0)`, `c = balanceAt(T1)`, both in the account's own currency.
2. **Per currency** (SUM-2): `O_cur = Σ o`, `C_cur = Σ c`, the difference and its direction.
3. **Equivalent** (SUM-3): `E0 = Σ_cur convert(O_cur, d0)` and `E1 = Σ_cur convert(C_cur, d1)`, each rounded per currency (rule 4.2.5). `change = E1 − E0`.
4. **Per account change** in the common currency: `a = round(convert(c − o, d1))`. **From balances** = `Σ a`. **From exchange rates** = `change − Σ a`. The rounding remainder lands here, so the two lines always add up to the change exactly (requirements 4.5, currency effect).
5. **Change by member and by account type**: sums of `a` per group. The total row equals "From balances".
6. **Biggest changes**: the five accounts with the largest `|a|`. Each opens its account (UI-SUM-4).
7. **Also in this check-in**: accounts whose value at `C` is `carried_forward` ("wasn't changed"), accounts whose first snapshot is after `T0` (added), and accounts deactivated between `T0` and `T1`.
8. **The first check-in** has no `P`. It shows the totals with "First check-in" and leaves out every comparison.
9. **Chart series** (SUM-4, CUR-6): one point per closed check-in. In "All in EUR" each point is `E` at its own date's rates, or with "Today's rates" every point is converted at the latest stored rates. A single currency shows `C_cur` in its own unit.

The summary is always computed from stored data, never stored (SUM-1). At PRF-1 volume (40 accounts, about 120 check-ins over 10 years) one query per check-in boundary is cheap, but the chart series must use one batched query, not one per point.

### 7. API

JSON over HTTPS. Every route requires a session with a chosen profile, except those marked *open* or *session without profile*. Errors use one shape: `{error: {code, message, fields?}}`. Codes: `validation`, `unauthenticated`, `profile_required`, `forbidden_state`, `not_found`, `conflict`, `locked`.

| Route | Purpose | Refs |
|---|---|---|
| `GET /api/health` *open* | DB reachable, migration version, app version; 503 otherwise | DEP-5 |
| `GET /api/setup` *open* | `{needed: boolean}` | MEM-1 |
| `POST /api/setup` *open, only while no member exists* | Password twice, profile names → creates the family and the first session | MEM-1 |
| `POST /api/auth/sign-in` *open* | Family password → session (opens the device's default profile if set) or `locked` with `retryAfter` and `triesLeft` | MEM-2, SEC-2 |
| `POST /api/auth/profile` *session without profile* | `{memberId, remember}` | MEM-2 |
| `GET /api/auth/me` *session without profile* | Session, profile, device, whether a passkey exists | |
| `POST /api/auth/sign-out` | Ends this session | |
| `POST /api/auth/passkey/{register,authenticate}/{options,verify}`; `DELETE /api/devices/current/passkey` | Task 29 | MEM-6 |
| `GET/POST /api/members`, `PATCH /api/members/:id` | List, add, rename, deactivate, reactivate | MEM-3 |
| `PUT /api/family/password` | Current + new (≥ 10 characters); signs out other sessions, removes other devices' passkeys | MEM-3, UI-AUTH-6 |
| `GET/PATCH /api/devices/current` | Default profile, hide amounts on Home | MEM-2, UI-HOME-4 |
| `GET /api/push/key`, `PUT/DELETE /api/push/subscription` | Web Push opt-in | NTF-2 |
| `GET /api/currencies`; `POST/PATCH/DELETE /api/coins[/:code]` | ISO list plus coins; a coin in use cannot be deleted | ACC-10, SET-1 |
| `GET/PATCH /api/settings` | Common currency, time zone, cadence, follow-up interval | CUR-1, DEP-9, CHK-2, CHK-3 |
| `GET /api/accounts?owner&type&currency&inactive`, `POST /api/accounts` | List with latest balance, its date, source and stale flag; create with optional opening balance | ACC-1–3, DSH-3 |
| `GET/PATCH/DELETE /api/accounts/:id`; `POST /api/accounts/:id/currency`; `POST /api/accounts/:id/(de|re)activate` | Settings, relabel, deactivate, delete only when empty | ACC-4, ACC-5, ACC-8 |
| `GET/POST /api/accounts/:id/snapshots`; `PATCH/DELETE /api/snapshots/:id`; `GET /api/snapshots/:id/revisions` | History, set balance, correct, delete | ACC-6, ACC-7, MEM-5 |
| `GET /api/checkins`; `POST /api/checkins` (start or join); `GET /api/checkins/current`; `GET /api/checkins/:id` | List and state with per-member progress | CHK-1, CHK-4, CHK-10, UI-SUM-1 |
| `PUT /api/checkins/:id/values/:accountId` `{amount}` or `{same: true}` | Saves one value immediately; may close the check-in | CHK-5–8 |
| `POST /api/checkins/:id/close` | Close now | CHK-8 |
| `GET /api/checkins/:id/summary`; `GET /api/wealth/series?view=equivalent|currency&currency=&rates=dated|today` | Summary and chart | SUM-1–6, CUR-6 |
| `GET /api/home` | Greeting data, open check-in banner (no amounts), wealth figure and change, backup warning | DSH-1, NTF-1, BKP-4 |
| `GET /api/rates/status` | Latest rate date per currency, last fetch and error | CUR-4 |
| `GET /api/backup/status`; `GET /api/export` | Last backup; zip of CSVs | BKP-3, BKP-4 |

Security on every route (SEC-1 to SEC-6):
- Cookies `bb_session` and `bb_device` are `HttpOnly; Secure; SameSite=Lax; Path=/`. In development over plain HTTP, `Secure` is dropped only when `NODE_ENV=development`.
- CSRF: state-changing requests must have `Content-Type: application/json` and pass an `Origin` check against `APP_ORIGIN` (`Sec-Fetch-Site: same-origin` is accepted when `Origin` is missing). Everything else gets 403.
- Failed sign-ins: a family-wide counter. After three wrong passwords in a row, sign-in is refused for 30 seconds; a correct password resets the counter (requirements section 11). The state survives a restart.
- The logger redacts `password`, `currentPassword`, `newPassword`, `cookie`, `set-cookie`, `authorization`, push keys and passkey material.
- The web app sets a CSP of `default-src 'self'`, with no inline scripts and no third-party origins (SEC-7). An E2E test fails on any request to another origin.

### 8. Screens in this spec

Each screen follows its `design-spec.md` section and `docs/design/html/screens/<Screen>.html|png`. Where a screen export and `bb.css` differ, `bb.css` wins.

| Screen | Route | Reference | Notes for spec 1 |
|---|---|---|---|
| First start | `/setup` | `Setup`, UI-AUTH-8 | Next steps: "Add your accounts", "Pick the check-in schedule", "Later, go to Home". |
| Sign in, profile picker, locked | `/sign-in` | `SignIn`, `SignInPick`, `SignInLocked`, UI-AUTH-2–4 | "Use Face ID" only when this device has a passkey (task 29). |
| Home | `/` | `Main`, UI-HOME-1–6 | D2: spec-1 parts only. The "Everything" grid shows Accounts, Check-ins, Wealth history (→ latest summary, D3) and Settings. Backup warning (BKP-4) as a `warn` card below the banner. |
| Profile sheet | sheet on Home | UI-AUTH-5 | |
| Check-in | `/check-in` | `CheckIn`, UI-CHK-1–8 | |
| Check-ins | `/check-ins` | `CheckIns`, UI-SUM-1 | Totals hidden by default, with an eye button. |
| Summary | `/check-ins/:id` | `CheckInSummary`, UI-SUM-2–4 | Opens the check-in itself while it is still open (UI-NAV-6). |
| Accounts | `/accounts` | `Accounts`, UI-ACC-1 | |
| Account | `/accounts/:id` | `AccountDetail`, UI-ACC-2–3 | Leave out the "Transactions" button until spec 2 and the "Bank IDs" field until `account_link` exists (D8). The balance history shows each snapshot's source. |
| New account | `/accounts/new` | `NewAccount`, UI-ACC-4 | |
| Settings | `/settings` | `Settings`, `SettingsSchedule`, UI-SET-1–3 | Leave out "Spending". "Exchange rates" opens a read-only status sheet (D6). New sheets: common currency, currencies and coins, time zone. |

Navigation and motion follow UI-NAV-1 to UI-NAV-6 and UI-MOT-1 to UI-MOT-3. The router keeps its own history stack in memory: Back pops it, or goes to the screen's natural parent when the stack is empty (UI-NAV-2). Every amount field uses the keypad (UI-AMT-1 to UI-AMT-4).

## Tasks

How to read a task: **Refs** are requirement and design IDs. **Depends** lists tasks that must be done first. **Parallel** names tasks that may be built at the same time. **Files** are the expected places; build may add files nearby. Every task must also meet the definition of done in `AGENTS.md`. "E2E" means a Playwright test in `web/e2e/` that runs on WebKit at both iPhone and iPad sizes.

### Milestone A: trials and skeleton

Try it: `pnpm dev` shows the component gallery in light and dark, and `/api/health` answers.

- [x] **1. Trial: price feeds.**
  Refs: CUR-2, CUR-3, CUR-7, requirements 10.1 #1, SEC-8. Depends: none. Parallel: 2, 3, 4.
  Files: this spec (section "Trial results" below), `server/test/fixtures/rates/`.
  Do: Test free feeds that need no key and have history for EUR, USD, RUB and the coins of O1. Candidates: the ECB reference rates (daily and historical files), the Bank of Russia daily rates by date, and a public coin price API with daily history (for example the coin APIs of large exchanges, or CoinGecko if it still has a keyless tier). For each feed, record: URL, format, history depth, publishing time, time zone of its dates, rate limits, terms of use, and whether a key is needed. Save one real response per feed as a fixture.
  Acceptance: "Trial results" lists a chosen feed for each of EUR↔USD, RUB and every O1 coin, with the reason; a fixture file exists for each chosen feed; anything the trial could not confirm is marked as unconfirmed.

- [x] **2. Workspace skeleton and commands.**
  Refs: QUA-1, QUA-2, AGENTS.md. Depends: none. Parallel: 1.
  Files: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.nvmrc`, `.gitignore`, `.env.example`, `shared/`, `server/`, `web/` stubs, `web/playwright.config.ts`, `.githooks/pre-commit`, `AGENTS.md` ("Stack and commands").
  Do: Set up the workspace of Design section 1. Root scripts: `dev` (Vite with `/api` proxied to Fastify, both reloading), `build`, `typecheck`, `lint`, `test` (Vitest in every package), `e2e` (build, start the server against a temporary `DATA_DIR` with `RATES_FEED=fixture`, run Playwright WebKit with the projects `iphone` 390 × 844 and `ipad` 820 × 1180), `format`. Vitest and Playwright use the `dot` reporter by default, so agent runs print failures only; `pnpm test -- --reporter=verbose` stays possible. Add `.githooks/pre-commit` running `pnpm typecheck && pnpm lint && pnpm test`, activated by a root `prepare` script (`git config core.hooksPath .githooks`). Fill in "Stack and commands" in `AGENTS.md` with the stack, the major versions and every command.
  Acceptance: on a fresh clone, `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` exits 0, and the E2E run includes one placeholder test per project; `AGENTS.md` lists the commands exactly as they run; a commit with a type error is refused by the hook.

- [x] **3. Money core in `shared`.**
  Refs: section 4.2, ACC-9, ACC-10, UI-AMT-2, UI-AMT-3, UI-TXT-1, UI-TXT-2, COR-1, QUA-3. Depends: 2. Parallel: 4, 5.
  Files: `shared/src/money/*`, `shared/src/time/*`, tests beside them.
  Do: ISO 4217 table, `Currency` lookup (ISO plus coins passed in), `roundHalfAwayFromZero`, `parseMinor`/`toMinorString`, `formatMoney`, `formatChange`, the expression evaluator with `lastCompleteValue`, `convert` over a rate lookup function (Design section 3), the date helpers (today in a time zone, end of a local day, DD/MM/YYYY, "Today"/"Yesterday"), and the cadence slot calculator (Design section 5).
  Acceptance: unit tests pass for at least: `(11244.14 + 12441.12) / 2 * 10%` = 1184.26 in EUR; `1/3` in EUR = 0.33 and `2/3` = 0.67; `−0.005` → −0.01 and `0.005` → 0.01; JPY rounds to 0 decimals and BTC to 8; `(1+2` and `5/0` and `1+` are rejected with a reason; a leading minus and `−` (U+2212) and `×`/`÷` are accepted; values above 2^53 stay exact; `formatMoney(-1450n, EUR)` = `−€14.50`; conversion uses the nearest earlier rate and reports `missing` before the first rate; a cross rate through a pivot is exact to the cent against a hand-computed value; monthly slots on the 31st, in a leap February, and across both daylight-saving changes in Europe/Berlin; every-2-weeks slots from an anchor.

- [ ] **4. Design system in `web`.**
  Refs: UI-VIS-1–6, UI-MOT-1–3, UI-A11Y-1–4, IOS-5, IOS-7, SEC-7. Depends: 2. Parallel: 3, 5.
  Files: `web/src/styles/` (tokens and components ported from `docs/design/html/bb.css`, `fonts/` copied from `docs/design/html/fonts/` with the licence), `web/src/components/` (`BbButton`, `BbChip`, `BbChipGroup` (radio group), `BbSegmented` (tab list), `BbSwitch`, `BbSheet`, `BbConfirmSheet`, `BbListCard`, `BbRow`, `BbTag`, `BbProgress`, `BbBackButton`, `BbAmount` (hidden or visible amount with its accessible label), `BbIcon`), `web/src/screens/dev/Components.vue` (route `/dev/components`, only in development and E2E builds).
  Do: Port `bb.css` faithfully; dark mode follows `prefers-color-scheme`; reduced motion turns every animation and transition off; safe-area padding for the notch and the home indicator. Use the style guide sections in `docs/design/styleguide/` (index in its README) and `components.html` for markup and ARIA.
  Acceptance: E2E opens `/dev/components` in light and dark and compares screenshots against committed baselines; E2E asserts that no request leaves the origin; with `reducedMotion: 'reduce'` the computed `transition-duration` of a sheet is 0 s; every icon-only button in the gallery has an accessible name; touch targets in the gallery measure at least 44 × 44 px.

- [ ] **5. Server skeleton, database and migrations.**
  Refs: DEP-2, DEP-3, DEP-4, DEP-5, SEC-6, COR-5. Depends: 2. Parallel: 3, 4.
  Files: `server/src/app.ts`, `server/src/config.ts` (zod-validated env), `server/src/db/schema.ts`, `server/drizzle/` (migrations), `server/src/db/migrate.ts`, `server/src/db/backup.ts` (`backupTo(path)` with `.backup()`), `server/src/clock.ts`, `server/src/modules/health/`.
  Do: The full schema of Design section 4 in a first migration. At start: open the DB in WAL mode with foreign keys on; if migrations are pending, write a `pre_migration` backup first, then migrate inside a transaction; on failure, log, leave the DB as it was and exit non-zero. Serve `web/dist` statically, falling back to `index.html` for client routes. Set up pino redaction, the error shape and the zod type provider.
  Acceptance: an integration test runs the migrations on an empty DB, and then once more as a no-op; a test with a deliberately failing migration shows the process exits non-zero, a `pre_migration` backup exists, and the DB still has its old version; `GET /api/health` gives 200 with the migration version, and 503 when the DB file is unreadable; a test logs a request with a `password` field and the log line does not contain the value.

### Milestone B: sign-in, profiles, shell

Try it: first start on an iPhone-sized browser, sign in, switch profiles, change the password.

- [ ] **6. App shell and navigation.**
  Refs: UI-NAV-1, UI-NAV-2, UI-NAV-4, UI-MOT-1, UI-MOT-3, IOS-2. Depends: 4. Parallel: 7 (API part).
  Files: `web/src/router/*`, `web/src/App.vue`, `web/src/screens/home/HomeScreen.vue` (placeholder content), `web/src/composables/useBack.ts`.
  Do: Routes of Design section 8 as placeholders, an in-memory history stack, push and pop transitions, Back labels per UI-NAV-2 ("Back to home", "Back to check-ins", …), and the fallback parent when there is no history. Layout uses the width on iPad (content column up to 640 px, centred) and stays usable in a desktop browser.
  Acceptance: E2E: Home → Accounts → Back returns to Home with the label "Back to home"; opening `/check-ins/1` directly and pressing Back goes to `/check-ins`; a sheet closes on its Close button and on a tap on the dimmed area; with reduced motion no transition runs.

- [ ] **7. First start.**
  Refs: MEM-1, UI-AUTH-8, SEC-2, SEC-4. Depends: 5, 6.
  Files: `server/src/modules/auth/`, `server/src/modules/setup/`, `web/src/screens/setup/`.
  Do: `GET/POST /api/setup`. The password is entered twice and must have at least 10 characters; at least one profile name; "+ Add a profile"; the first profile becomes this device's default and the session opens as it. Then show the next steps. `POST /api/setup` returns `forbidden_state` once any member exists.
  Acceptance: integration tests: setup creates the family row with an argon2id hash (never the plain password), the members, a device with its default and a session; a second setup is refused; mismatched or short passwords are refused with field errors. E2E: a fresh install opens `/setup`, completes it, and lands on the next-steps view; a reload then opens Home.

- [ ] **8. Sign-in, sessions and the profile sheet.**
  Refs: MEM-2, MEM-4, SEC-1, SEC-2, SEC-3, UI-AUTH-1–5, UI-HOME-1 (greeting and avatar only). Depends: 7.
  Files: `server/src/modules/auth/*`, `server/src/plugins/{session,csrf}.ts`, `web/src/screens/sign-in/`, `web/src/screens/home/ProfileSheet.vue`, `web/src/router/guards.ts`.
  Do: Sign-in per Design section 7; the profile picker with "Remember on this device"; the locked view with the countdown ("Wait 30 s"); "Forgot password?" text (UI-AUTH-4); route guards (no session → `/sign-in`, no members → `/setup`, no profile → picker). Profile sheet from the Home avatar: radio list, "Default on this iPhone" marker (use the device type in the copy: iPhone, iPad, or "this device"), "Open as … on this iPhone" switch, "Sign out". Sessions last 90 days, extended on use.
  Acceptance: integration tests: every route except the open ones returns 401 without a session (iterate the route table, so a new route cannot forget its guard); a POST with a foreign `Origin` returns 403; the third wrong password returns `locked` with `retryAfter` 30, the counter survives a server restart, and a correct password after the wait resets it; an expired session is refused; a deactivated profile cannot be opened. E2E: a wrong password shows "That password doesn’t match. 2 tries before a short wait."; a device with a default opens straight into Home with "Hi, <name>"; switching profile in the sheet changes the greeting at once.

- [ ] **9. Settings: profiles and family password.**
  Refs: MEM-3, MEM-5 (attribution), SET-1, UI-SET-1, UI-AUTH-6. Depends: 8.
  Files: `server/src/modules/members/`, `server/src/modules/family/`, `web/src/screens/settings/` (the screen with every spec-1 section in order; rows owned by later tasks show "—" until built).
  Do: Add, rename, deactivate and reactivate profiles (a confirmation sheet for deactivating); change the family password. The other devices' sessions end and their passkeys are removed; the current session stays.
  Acceptance: integration tests: after a password change, another session gets 401 and the current one still works; the last active profile cannot be deactivated; renaming to an existing active name is refused. E2E: add a profile, rename it, deactivate it, and it disappears from the profile picker.

### Milestone C: accounts and check-in

Try it: create accounts for two profiles, run a check-in from two browser windows, close it.

- [ ] **10. Keypad and amount field.**
  Refs: ACC-9, IOS-4, UI-AMT-1–4, UI-A11Y-3. Depends: 3, 4. Parallel: 11, 12.
  Files: `web/src/components/BbKeypad.vue`, `web/src/components/BbAmountInput.vue`.
  Do: The 4 × 5 keypad of UI-AMT-1; expression line; live result; error "Can’t calculate that. Check the brackets." with `role="alert"`; a leading minus only when the field allows negatives; "Start from last" puts the previous balance into the expression. A hardware keyboard on iPad and desktop works too. The system keyboard never opens.
  Acceptance: component tests for typing `12+3×2` (expression shown, result 18.00), `(1+` (last complete result shown, save disabled), `C`, `⌫`, and a minus refused where negatives are not allowed; E2E on iPhone size: tapping the field does not focus a native input (no `inputmode` keyboard).

- [ ] **11. Currencies, coins and money settings.**
  Refs: ACC-10, CUR-1, DEP-9, SET-1, O1. Depends: 9. Parallel: 10, 12.
  Files: `server/src/modules/currencies/`, `server/src/modules/settings/`, `web/src/screens/settings/{CommonCurrencySheet,CoinsSheet,TimeZoneSheet}.vue`.
  Do: Seed the coins of O1 on first start. Coin editor: code, name, decimals (capped at 8, with the hint "Stored with at most 8 decimals"); a coin in use cannot be deleted. Common currency picker (ISO currencies and coins in use). Time zone picker (IANA list from `Intl.supportedValuesOf('timeZone')`, searchable).
  Acceptance: integration tests: a coin code that clashes with ISO 4217 is refused; 18 decimals are refused; deleting a coin used by an account returns `conflict`; changing the common currency changes no stored amount (row count and sums of `snapshot.amount` unchanged).

- [ ] **12. Accounts and snapshots API.**
  Refs: ACC-1–8, ACC-10, MEM-5, COR-5, SEC-4, section 4.3. Depends: 9, 3. Parallel: 10, 11.
  Files: `server/src/modules/accounts/`, `server/src/modules/snapshots/`, `server/src/domain/balance.ts` (`balanceAt`).
  Do: The routes of Design section 7. Create with an optional opening snapshot (source `opening`). A "we owe" account takes a positive amount from the client form and stores it negated: the API receives the signed amount, and the form does the negation (task 13). Set balance now or at an earlier date (source `manual`). Correct and delete with revisions. Relabel the currency per Design section 5. Deactivate with a stored date. Delete only without snapshots (and, from spec 2, transactions). Set `created_by`/`updated_by` from the session's profile.
  Acceptance: integration tests: deleting an account with a snapshot returns `conflict`; deactivating sets `deactivated_at` and `balanceAt` after it returns 0; a correction writes a `snapshot_revision` row with the old amount and the profile; relabelling EUR→JPY rescales 198630 to 1986 and the confirmation payload names the example; an amount string with a decimal point is refused; listing 40 accounts with latest balances runs in one query (assert the query count); two snapshots of one account at the same `taken_at` with sources `manual` and `connector` (inserted directly in the test) resolve to the `connector` one in both `balanceAt` and the list; a `carried_forward` and a `checkin` snapshot at the same instant resolve to the `checkin` one; inserting two snapshots with the same `source_ref` and `external_id` fails on the unique index.

- [ ] **13. New account screen.**
  Refs: ACC-1, ACC-2, UI-ACC-4. Depends: 10, 11, 12.
  Files: `web/src/screens/accounts/NewAccountScreen.vue`.
  Acceptance: E2E: create "ING Girokonto", type Bank, EUR, opening balance `1986.30`, today → the account shows €1,986.30 with source "Opening"; create a "Money we owe" account with `500` → its balance shows −€500.00 and the hint of UI-ACC-4 is visible; "Other…" finds a coin from the coin list.

- [ ] **14. Accounts list.**
  Refs: ACC-3, DSH-3, UI-ACC-1. Depends: 12. Parallel: 13, 15.
  Files: `web/src/screens/accounts/AccountsScreen.vue`.
  Acceptance: E2E with seeded data: the owner control filters to one profile; the Type and Currency chips filter; "Show inactive" reveals an inactive account with its "Inactive" tag; an account whose balance is older than the cadence shows "Stale"; groups read "Yours" and "Max’s".

- [ ] **15. Account page and account settings.**
  Refs: ACC-4–8, MEM-5, UI-ACC-2, UI-ACC-3, UI-NAV-4. Depends: 10, 12. Parallel: 14.
  Files: `web/src/screens/accounts/AccountScreen.vue`, `web/src/components/charts/LineChart.vue` (shared with task 22), sheets beside the screen.
  Do: Balance, chart with range options (3 M, 1 Y, All), "Set balance" (keypad with "Today" or "Earlier date…"), "Balance history · tap to correct" with "Save correction" and "Delete", and the settings of UI-ACC-3 including the relabel warning and the deactivate confirmation. When deletion isn't possible, say why. The `LineChart` is plain SVG: one line, high and low labelled, month ticks, accessible summary text, drawn in on open (UI-MOT-2), no animation with reduced motion.
  Acceptance: E2E: set balance with `+120` after "Start from last" → the new balance is the old + 120 and is first in the history; correcting a snapshot changes it and the history sheet shows "Changed by <profile>"; the currency relabel sheet shows the example text and only proceeds after the confirming button "Relabel as USD"; deactivating asks first and the account then shows "Inactive".

- [ ] **16. Check-in API.**
  Refs: CHK-1, CHK-4 (event only), CHK-5–8, CHK-10, CHK-12, MEM-5, Design section 5. Depends: 12.
  Files: `server/src/modules/checkins/`, `server/src/domain/checkin.ts`, `server/src/events.ts` (in-process event bus: `checkin.opened`, `checkin.closed`, consumed by task 25).
  Acceptance: integration tests: starting while one is open returns the open one (join), and two concurrent starts create one row; "Same" stores a `checkin` snapshot equal to the previous balance; saving a value twice keeps one snapshot and writes a revision; the last value closes the check-in in the same request, with `closed_by` null; "Close now" carries forward exactly the accounts without a value, at `closed_at`; a value after closing returns `forbidden_state`; an account created during the open check-in is required, and a deactivated one stops being required; progress per member matches the values; a profile with no active accounts gets `needsAccounts: true` (CHK-12).

- [ ] **17. Check-in screen.**
  Refs: CHK-5–10, CHK-12, UI-CHK-1–8, UI-NAV-3. Depends: 10, 16.
  Files: `web/src/screens/checkin/`.
  Do: Per design. Saving is immediate, and a failed save shows the row as not saved with "Try again". When another member's value arrives, it shows on the next load or when the window regains focus (no live push of values is needed). For CHK-12, show the prompt to create an account, linking to New account.
  Acceptance: E2E with two browser contexts as two profiles: A taps "Same" on one account and types `2140.55 + 120` on another with "Save & next" → the next account's sheet opens; B reloads and sees A's tab as "N left"; B fills the rest of their own accounts and then A's last one from A's tab → the check-in closes by itself and B sees "See summary"; Back from the summary goes to Home (UI-NAV-3). Second scenario: "Close now" shows "3 accounts without a value will keep the last balance, marked as “wasn’t changed”." with "Keep it open".

- [ ] **18. Check-ins list.**
  Refs: SUM-1, CHK-1, UI-SUM-1. Depends: 16. Parallel: 17.
  Files: `web/src/screens/checkins/CheckInsScreen.vue`.
  Acceptance: E2E: with an open check-in, the card shows "Open now · since …" and per-member progress; with none, "Start a check-in now" with the next scheduled date (or no date when the cadence is off) starts one and opens it; closed check-ins list their date, who closed them (or "Closed by itself") and how many weren't changed; totals are hidden until the eye button is tapped.

### Milestone D: rates, summary, Home

Try it: close a second check-in and read its summary; reveal the wealth figure on Home.

- [ ] **19. Job runner.**
  Refs: COR-3, PRF-2, DEP-9. Depends: 5. Parallel: 16–18.
  Files: `server/src/jobs/runner.ts`, `server/src/jobs/types.ts`.
  Do: A runner that wakes every minute and at start. Each job declares `dueSlots(now, settings, lastDoneSlot)` and `run(slot)`. The runner claims a slot by inserting into `job_run` (unique), runs it off the request path, and records the result. At start, it makes up the latest missed slot of each job (not every missed slot). A job failing does not stop the others.
  Acceptance: unit tests with a fake clock: a slot runs once even when two ticks overlap; after a simulated downtime across two slots, only the latest is made up; a failed run is retried at the next tick, up to a limit per job, and then waits for the next slot.

- [ ] **20. Rates: feeds, daily job and backfill.**
  Refs: CUR-2, CUR-3, CUR-4, CUR-7, SEC-8, task 1 results. Depends: 1, 3, 11, 19.
  Files: `server/src/rates/feed.ts` (interface), `server/src/rates/feeds/*` (one per chosen feed), `server/src/rates/fixtureFeed.ts`, `server/src/rates/service.ts`, `server/src/jobs/rates.ts`, `web/src/screens/settings/RatesStatusSheet.vue`.
  Do: The daily job at 06:00 local time fetches today's rates for every currency in use (account currencies, the common currency, coins in use), then retries hourly until each feed has published. Backfill: when an account is created or a dated snapshot is added for a currency or date without rates, fetch the missing range in the background. Outbound requests go only to the chosen feed hosts (an allowlist in config), with a timeout. When a feed fails, nothing breaks: the status sheet shows the age of the latest rate per currency and the last error.
  Acceptance: integration tests with the fixture feed: the job stores rates for the currencies in use only; running it twice stores nothing twice; a backfill for a date range three years back fills every published date; a feed that throws leaves stored rates untouched and records the error; a request to a host outside the allowlist is refused by the HTTP client wrapper.

- [ ] **21. Summary and series computation.**
  Refs: SUM-1–6, CUR-6, section 4.3, section 4.5 (currency effect), COR-4, PRF-1. Depends: 16, 20.
  Files: `server/src/domain/summary.ts`, `server/src/modules/summary/`.
  Do: Design section 6.
  Acceptance: unit tests on a hand-built data set with EUR, USD, RUB and BTC accounts across three check-ins, with expected numbers written in the test from a worked example: per-currency totals and differences; the equivalent at each close date's rates; "From balances" + "From exchange rates" = change, exactly, including a case where rounding leaves a remainder; member and type rows sum to "From balances"; a carried-forward account is listed under "wasn't changed"; an account added and one deactivated between check-ins appear in "Also in this check-in"; the first check-in has no comparison; a missing rate makes the equivalent "incomplete" rather than wrong; the "Today's rates" series uses the latest rates for every point. A performance test with PRF-1 volume (40 accounts, 120 check-ins) computes a summary and the series in under 200 ms on the developer machine.

- [ ] **22. Summary screen.**
  Refs: SUM-1–6, CUR-6, UI-SUM-2–4, UI-NAV-2, UI-NAV-6. Depends: 15 (LineChart), 21.
  Files: `web/src/screens/summary/`.
  Acceptance: E2E: the summary of a seeded check-in shows "Check-in DD/MM/YYYY · Compared with DD/MM/YYYY", the total with ▲ or ▼, "From balances" and "From exchange rates", per-currency rows matching the seed, and the chart with pills for "All in EUR" and each currency; "Today’s rates" changes the series; a "Biggest changes" row opens its account; opened from Home, Back goes Home; opened from Check-ins, Back goes to Check-ins; `/check-ins/<open id>` shows the check-in.

- [ ] **23. Home.**
  Refs: DSH-1, DSH-3 (warning only where shown), NTF-1, BKP-4, UI-HOME-1–6 (D2 subset), UI-A11Y-3, O2. Depends: 17, 21.
  Files: `server/src/modules/home/`, `web/src/screens/home/`.
  Do: Per D2 and O2 (current wealth). Amounts are hidden on every app start unless the device setting turns that off. The eye button reveals for 30 s with the note "Amounts visible · hiding again in 30 s", and tapping again hides at once. The revealed state is never stored. The banner copy follows UI-HOME-5 and contains no amounts. The wealth card opens the latest summary, and with no closed check-in it says "No check-in yet". A backup older than two days shows a `warn` card "Last backup was N days ago" linking to Settings.
  Acceptance: E2E: after a reload, the wealth figure is "€ • • • • •" with the label "Amount hidden" and the text "Hidden · last check-in DD/MM/YYYY"; the eye reveals it, and after 30 s (fake timers) it is hidden again; with "Hide amounts on Home" off, a reload shows the amount; the banner reads "Monthly check-in is open · Opened today · N of your accounts to check" for a scheduled check-in and "Check-in is open · Max started it today · N of your accounts left" for one started by a member, with no digits other than N; the "Everything" grid shows exactly Accounts, Check-ins, Wealth history and Settings.

### Milestone E: schedule, notifications, backup, deployment

Try it: on the Mac mini, through Tailscale, install the app on an iPhone, get a scheduled check-in push, restore a backup.

- [ ] **24. Check-in schedule.**
  Refs: CHK-2, UI-SET-2, COR-3, DEP-9. Depends: 16, 19, 11.
  Files: `server/src/jobs/checkinSchedule.ts`, `web/src/screens/settings/ScheduleSheet.vue`.
  Do: The schedule sheet (Off; Monthly on a day 1–28 or "Last day"; Every N weeks on a weekday) with a time, and a preview in words ("Monthly on the 5th at 09:00. Next: 5 November."). The job opens a check-in at each slot when none is open (stored with `schedule_slot`) and emits `checkin.opened` with "by schedule". When one is already open, the slot does nothing except the reminder of task 25.
  Acceptance: unit tests with a fake clock: the monthly slot on the 31st in a 30-day month runs on the last day when "Last day" is chosen; a server off across the slot opens one check-in at start, not two; a slot during an open check-in opens nothing; changing the cadence moves the next slot without opening one.

- [ ] **25. Trial and build: Web Push.**
  Refs: NTF-2, NTF-3, NTF-4, CHK-4, CHK-9, UI-SET-3, UI-NAV-6, requirements 10.1 #2. Depends: 23, 24. The code is built now; the trial on real devices runs once tasks 27 and 30 have put the installable app on HTTPS, and is recorded before task 31.
  Files: `server/src/modules/push/`, `server/src/notify/` (event → recipients → text), `web/src/sw.ts` (push and `notificationclick`), `web/src/screens/settings/NotificationsSheet.vue`, this spec ("Trial results").
  Do: Generate VAPID keys into `DATA_DIR/keys` on first start. Opt-in from Settings → This device → Notifications, after the explainer sheet of UI-SET-3 and a tap (iOS needs the tap). Events and recipients: scheduled check-in → every active member; started by a member → every other active member, naming who ("Max started a check-in"); closed → every active member; follow-up → task 26. Texts never contain amounts. A click opens `/check-ins/<id>`, which shows the check-in while it is open and the summary once it is closed. Subscriptions that answer 404 or 410 are removed. The `notification` table prevents duplicates. Without permission everything else still works (NTF-3).
  Trial (with the owner, on the real devices once task 27 is deployed): install on each family iPhone and iPad, opt in, trigger each event, and record in "Trial results" which devices received which notification and how quickly. If push is unreliable on a device, the banner is that device's only reminder (requirements 10.1 #2) and the spec says so.
  Acceptance: integration tests with the fake `PushSender`: each event goes to the right members only, once; no payload contains a currency symbol, a currency code or a number with a decimal separator (NTF-4); a 410 removes the subscription. E2E: the explainer sheet appears before the permission request, "Not now" closes it and nothing is requested. Trial results recorded.

- [ ] **26. Follow-up reminders.**
  Refs: CHK-3, NTF-2, UI-CHK-7 ("Next reminder in 2 days"), UI-SET-1. Depends: 25.
  Files: `server/src/jobs/followUp.ts`, `web/src/screens/settings/FollowUpSheet.vue`.
  Do: While a check-in is open, every `followup_days` days after it opened (at the cadence time, or at the opening time for a manual one), remind each active member who still owns accounts without a value. 0 turns it off. The check-in footer shows when the next reminder is due, or leaves that sentence out when reminders are off.
  Acceptance: unit tests with a fake clock: reminders go only to members with accounts left; none after closing; a restart after a missed reminder sends one, not several; the setting 0 sends none.

- [ ] **27. Installable app and offline shell.**
  Refs: IOS-1, IOS-3, IOS-5, IOS-6, O4. Depends: 23.
  Files: `web/vite.config.ts` (PWA), `web/public/` (manifest icons, `apple-touch-icon.png`), `web/index.html` (`viewport-fit=cover`, `apple-mobile-web-app-capable`, theme colours for light and dark), `web/src/components/OfflineNote.vue`.
  Do: The manifest with `display: standalone`, name "Budget Buddy" and the icon of O4. The service worker precaches the app shell and fonts. Without a connection, the app opens, shows "You’re offline. Showing what was loaded last." and disables actions that need the server.
  Acceptance: E2E: the manifest is served and valid (name, icons 192 and 512, standalone); with the context set offline after a first load, a reload shows the shell and the offline note; content stays clear of the safe areas at iPhone size (no element of the header above `env(safe-area-inset-top)`, checked with a simulated inset).

- [ ] **28. Backup, restore and export.**
  Refs: BKP-1–4, DEP-4, COR-3, SEC-6. Depends: 19, 5.
  Files: `server/src/jobs/backup.ts`, `server/src/modules/backup/`, `server/src/modules/export/`, `web/src/screens/settings/{BackupSheet,ExportRow}.vue`, `scripts/restore.sh`, `scripts/restore-test.sh`, README section "Restore".
  Do: Nightly at 03:30 local time, write `BACKUP_DIR/daily/budget-buddy-YYYY-MM-DD.sqlite` with SQLite's online backup, verify it with `PRAGMA integrity_check`, and on the 1st copy it to `monthly/`. Keep 14 daily and 12 monthly copies. Images: copy new files from `DATA_DIR/images` (empty in spec 1, but the code path exists and is tested). Settings shows the time and size of the last backup. Export: a zip of CSV files (members, accounts, snapshots, snapshot revisions, check-ins, rates, coins, settings without the password hash). Amounts are written as decimal strings with a currency column. `restore.sh <backup file>` stops the container, keeps the current DB aside, copies the backup in and starts the container. `restore-test.sh` builds the image, starts it with a temporary data dir, creates data through the API, runs the backup job, starts a second container with a fresh data dir, restores, and compares the API's account list and check-ins.
  Acceptance: integration tests: the job twice for the same night writes one file; pruning keeps exactly 14 and 12; the backup passes the integrity check while writes happen during it; the export zip contains every listed CSV, and amounts in it match the DB. `scripts/restore-test.sh` exits 0. Output is recorded in the task's commit message.

- [ ] **29. Face ID unlock (passkey).**
  Refs: MEM-6, UI-AUTH-2, UI-AUTH-7, SEC-1. Depends: 9. Parallel: 24–28.
  Files: `server/src/modules/passkey/`, `web/src/screens/settings/FaceIdRow.vue`, sign-in screen.
  Do: Settings → Sign-in → "Unlock with Face ID" registers a platform passkey for this device, with user verification required. The relying-party ID and origin come from `APP_ORIGIN`. Sign-in shows "Use Face ID" when this device has one; success opens a session like the password does, and failures count toward the lockout. Turning the switch off deletes the passkey. A family password change removes the passkeys of the other devices (Design section 7).
  Acceptance: integration tests with `@simplewebauthn`'s test helpers or a software authenticator: registration and authentication succeed; a credential of another device is refused; after a password change, other devices' passkeys are gone. E2E (WebKit with a virtual authenticator where Playwright supports it; otherwise covered by the owner trial in task 31): the switch on registers, and sign-in with "Use Face ID" opens Home.

- [ ] **30. Docker, compose, Tailscale Serve and README.**
  Refs: DEP-1–8, DEP-10, SEC-8, requirements 10.1 #3, 10.3. Depends: 28.
  Files: `Dockerfile`, `.dockerignore`, `compose.yaml`, `.env.example`, `README.md`.
  Do: A multi-stage build on `node:24-slim` for `linux/arm64`: install with the frozen lockfile, build `shared`, `web` and `server`, prune dev dependencies, run as a non-root user. `compose.yaml`: one service `app`, `restart: unless-stopped`, port `127.0.0.1:${PORT:-8080}:8080`, volumes `./data:/data` and `./backups:/backups`, a healthcheck on `/api/health`, `TZ` unset (the app's own setting governs), and a commented placeholder showing where optional services will go, off by default (DEP-10). README: requirements, first install (`.env` from the example, `APP_ORIGIN=https://<host>.<tailnet>.ts.net`, `docker compose up -d`, `tailscale serve --bg 127.0.0.1:8080`, opening the URL on an iPhone and adding it to the Home Screen), update, restore (task 28), password reset on the host (`docker compose exec app node server/dist/cli.js reset-password`, referenced by UI-AUTH-4), and the host preparation still to do from requirements 10.3. Add that CLI command.
  Acceptance: `docker build --platform linux/arm64 .` succeeds; `docker compose up -d` and then `curl -fsS http://127.0.0.1:8080/api/health` returns 200 within 30 s; killing the Node process makes the container restart; the port is not reachable on the host's LAN address; idle memory of the container after start is recorded in the commit message (DEP-8, target below 150 MB). On the Mac mini (owner-assisted): Tailscale Serve reaches the container over HTTPS from a phone in the tailnet, and the result is recorded in "Trial results" (requirements 10.1 #3).

- [ ] **31. Spec acceptance on the real setup.**
  Refs: roadmap spec 1 "Done when", QUA-2. Depends: all.
  Files: this spec ("Trial results" and the ticked checklist below).
  Do: With the owner, go through this list on the Mac mini and the family's devices, and record the date and result of each:
  - [ ] The app runs on the Mac mini and is reachable only through Tailscale (fails from the home Wi-Fi without Tailscale, works with it).
  - [ ] Two members complete a check-in from their phones.
  - [ ] The summary shows the comparison with the previous check-in and the chart.
  - [ ] A scheduled reminder arrives as a push notification on an iPhone.
  - [ ] A backup has been restored into a fresh container.
  - [ ] Face ID unlock works on at least one iPhone.
  Acceptance: every line is ticked with a date, or the failure is described, and the owner has seen it.

### Parallel work

The order of milestones is fixed. Inside them, these groups can be built at the same time: {1, 2}; {3, 4, 5} after 2; {10, 11, 12} after 9; {13, 14, 15} after 12; {16, 19}; {17, 18} after 16; {24, 28, 29} once their dependencies are done.

## Verification

All of these must pass for the whole spec, from a fresh clone on the Mac mini:

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e                      # Playwright WebKit, iPhone and iPad projects
pnpm build
docker build --platform linux/arm64 -t budget-buddy .
docker compose up -d && curl -fsS http://127.0.0.1:8080/api/health
scripts/restore-test.sh
```

Then task 31 is ticked with the owner.

## Trial results

To be filled in by tasks 1, 25, 30 and 31.

| Trial | Date | Result | Decision |
|---|---|---|---|
| Price feeds (task 1) | 2026-10-07 | Seven keyless feeds were called from the Mac mini (a German IP address). The ECB, the Bank of Russia and Coinbase Exchange cover EUR, USD, RUB, BTC, ETH and USDT with daily history and no key. Details are in "Price feeds (task 1)" below. | EUR↔USD and other ISO currencies: ECB reference rates. RUB: Bank of Russia. BTC, ETH, USDT: Coinbase Exchange daily candles against EUR. Fallback for coins, tested but not built: Binance market-data API. |
| Web Push on the family's devices (task 25) | | | |
| Tailscale Serve to a Rancher Desktop port (task 30) | | | |
| Spec acceptance (task 31) | | | |

### Price feeds (task 1)

Tested on 2026-10-07 between 20:50 and 20:55 UTC with `curl` from the Mac mini, without a key, cookie or special header. Fixtures are in `server/test/fixtures/rates/` (see the README there).

#### Chosen feeds

| Pair | Feed | Reason |
|---|---|---|
| EUR↔USD (and every other ISO currency the ECB lists, about 30) | ECB euro foreign exchange reference rates | Official, no key, one small file per day, history back to 1999 in one file, free reuse when the ECB is named as the source. |
| RUB (RUB per EUR, RUB per USD) | Bank of Russia, `XML_daily_eng.asp` and `XML_dynamic.asp` | The ECB's last RUB rate is 2022-03-01 (confirmed in `eurofxref-hist.xml`). The Bank of Russia is the official source, needs no key, answers by date and by date range, and reaches back to 1992. |
| BTC, ETH, USDT (each against EUR) | Coinbase Exchange, public product candles | No key, a documented limit, a direct EUR pair for all three coins (no inversion, no second pivot), and daily history deep enough for the app. |

#### What each chosen feed does

| | ECB | Bank of Russia | Coinbase Exchange |
|---|---|---|---|
| URL | `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (latest day), `eurofxref-hist-90d.xml` (64 dates), `eurofxref-hist.xml` (everything) | `https://www.cbr.ru/scripts/XML_daily_eng.asp?date_req=DD/MM/YYYY` (all currencies of one date), `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=DD/MM/YYYY&date_req2=DD/MM/YYYY&VAL_NM_RQ=<id>` (one currency over a range; EUR is `R01239`, USD is `R01235`) | `https://api.exchange.coinbase.com/products/<COIN>-EUR/candles?granularity=86400&start=<ISO>&end=<ISO>` |
| Format | XML, UTF-8. `<Cube time='2026-10-07'><Cube currency='USD' rate='1.1177'/>`: units of the currency per 1 EUR, as a decimal string. | XML declared `windows-1251`, decimal comma, `Nominal` plus `Value`, and `VunitRate` per one unit: RUB per unit of the currency. | JSON array, newest first, of `[time, low, high, open, close, volume]`. `time` is the start of the UTC day in seconds. Prices are JSON numbers. |
| History | 1999-01-04 to today, 7,109 dates. The full file is 8.2 MB (957 kB gzipped; `eurofxref-hist.zip` holds the same as CSV in 641 kB). | Daily file answers for 1992-07-01. The EUR series starts 1999-01-01: one range request for 1999 to today returned 6,886 records in 818 kB and 1.2 s. | BTC-EUR from 2015-04-23, ETH-EUR from 2017-05-23, USDT-EUR from 2021-05-04. At most 300 candles per request (a larger range gets HTTP 400). BTC-EUR had a candle for every day of a nine-month sample in 2019. |
| Publishing time | "Around 16:00 CET every working day, except on TARGET closing days" (ECB page). Seen: `Last-Modified` 13:56 GMT = 15:56 CEST on 2026-10-07. No file on weekends. | A rate is dated with the day it takes effect and is published the evening before: at 23:51 Moscow time on 7 October the rate of 08.10.2026 was there. Saturdays have a rate (set on Friday); Sundays and Mondays do not. | Continuous. The candle of the current UTC day is returned while it is still changing; a day is final at 00:00 UTC of the next day. |
| Time zone of its dates | Frankfurt working day (CET/CEST). | Moscow date. | UTC day. |
| A date without a rate | Not in the file. | The daily file answers with the latest earlier date and says so in `ValCurs Date=` (asked 04/10/2026, a Sunday, got `03.10.2026`; asked a future date, got the latest). The range file leaves the date out. | No candle in the array. |
| Rate limit | None documented. `Cache-Control: max-age=300`. | None documented. The user agreement forbids "actions that may disrupt the normal operation of the site's services". | 10 requests per second per IP, bursts to 15, then HTTP 429 (Coinbase docs). |
| Terms | "May make free use of the information", the ECB must be cited as the source; rates are "for information purposes only" (ECB copyright page). | A link to the site is required when its materials are quoted (user agreement, clause 3.2). | Public market data needs no authentication (Coinbase docs). |
| Key needed | No | No | No |
| Hosts for the allowlist (task 20) | `www.ecb.europa.eu` | `www.cbr.ru` | `api.exchange.coinbase.com` |

#### Feeds tested and not chosen

| Feed | Finding |
|---|---|
| Binance market data, `https://data-api.binance.vision/api/v3/klines?symbol=BTCEUR&interval=1d` | Works without a key from Germany. BTCEUR, ETHEUR and EURUSDT all start 2020-01-03, 1,000 days per request, prices as strings, 6,000 request weight per minute per IP (a 1,000-day request cost 2). USDT has no EUR pair of its own (`USDTEUR` is "Invalid symbol"), so its rate is the inverse of EURUSDT. Kept as the fallback: it would fit behind the `RateFeed` interface unchanged. Not first choice because of the inverted pair and because Binance refuses some countries. |
| CoinGecko, `https://api.coingecko.com/api/v3/coins/<id>/history?date=DD-MM-YYYY` | The keyless tier still answers, and gives EUR, USD and RUB prices in one call. Rejected: history is limited to the past 365 days (HTTP 401, error 10012, for a 2023 date), and the fourth request within a few seconds got HTTP 429. |
| Kraken, `https://api.kraken.com/0/public/OHLC?pair=XBTEUR&interval=1440` | No key, XBT, ETH and USDT against EUR. Rejected: it returns only the latest 720 daily candles (from 2024-10-17), whatever `since` says, so it cannot backfill. |
| Bitstamp, `https://www.bitstamp.net/api/v2/ohlc/btceur/?step=86400&limit=1000` | No key, 1,000 candles per request, USDT/EUR from 2021-06-10. Not chosen: nothing over Coinbase, and a `start` before the pair's first candle returns an empty list instead of the first candles. |
| ECB Data Portal API, `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=…&endPeriod=…&format=csvdata` | Works, gives the same figures by date range as CSV. Not needed: the three files cover every case with less parsing. Usable if the file URLs ever change. |
| Frankfurter, `https://api.frankfurter.dev` | Works, but it only republishes the ECB rates through a third party. |

#### Notes for task 20

- **Which candle value is a coin's rate.** Use the close of the UTC-day candle: the rate of date D is the close of D, and it is stored only once D is over (from 00:00 UTC of D + 1), because stored rates are never rewritten. The 06:00 job therefore stores yesterday's coin rate, and today's figures use it through the "nearest earlier date" rule until the next day. This is the same as with the ECB, whose rate of D arrives around 16:00.
- **"Published" per feed**, for the hourly retry: ECB, the daily file's `time` equals today (never on weekends and TARGET closing days, so the retry must stop at the end of the day without recording an error); Bank of Russia, `ValCurs Date` equals the asked date (already true at 06:00, except Sundays and Mondays); Coinbase, yesterday's candle is in the answer.
- **Pairs to store.** ECB: EUR→each currency in use. Bank of Russia: EUR→RUB and USD→RUB (stored as RUB per unit). Coinbase: coin→EUR. Every pair then reaches EUR directly or through one pivot, as `convert` expects.
- **Backfill.** ECB: `eurofxref-hist-90d.xml` when the gap is inside it, otherwise `eurofxref-hist.xml` once (ask for gzip). Bank of Russia: one `XML_dynamic.asp` request per currency for the whole range. Coinbase: windows of at most 300 days per coin.
- **Exact decimals.** ECB and Bank of Russia rates arrive as text and are stored as they are (comma replaced by a point). Coinbase prices are JSON numbers: store the number's shortest decimal form (`String(n)`), never the result of arithmetic on it.
- **Dates.** Each feed's date label is stored as it is given. The three calendars differ by a few hours (Frankfurt, Moscow, UTC), which is accepted.
- **Attribution.** The ECB and the Bank of Russia ask to be named as the source. The read-only rates sheet (task 20) should name the source of each rate; the `rate.source` column already holds it.

#### Unconfirmed

- The Bank of Russia's publishing time of day. Only seen: the next day's rate existed at 23:51 Moscow time, and a third-party mirror stamped it 20:00.
- Request limits of the ECB files and of `cbr.ru`: none are documented, and none were hit with about ten requests each.
- Coinbase's terms for reusing its market data beyond "public, no authentication". The app only stores the prices for the family's own use.
- What the ECB daily file contains on a TARGET closing day (expected: the previous working day's rates, unchanged). No such day fell in the trial.
- Whether `cbr.ru` and `api.exchange.coinbase.com` are reachable from inside the Docker container on the Mac mini. The trial ran on the host itself; task 30 will show it.
- Gaps in Coinbase's ETH-EUR and USDT-EUR daily history. Only BTC-EUR was checked for gaps (2019, none); a missing day is covered by the "nearest earlier date" rule.

## Change log

- 2026-10-06: written by `plan` with the owner's answers on stack, Home scope, extras and spec shape (D1–D7).
- 2026-10-06: D8 added with the owner: several data sources per account; `account.data_source` and `bank_ids` dropped; `source_ref` and `external_id` on snapshots; tie rule for snapshots at the same instant; `account_link` planned for later specs.
- 2026-10-07: the owner accepted the defaults of O1–O4; the section is now "Settled open items".
- 2026-10-07: task 2 gained quiet test reporters and a pre-commit hook (typecheck, lint, unit tests), after the pre-implementation audit of the agent setup.
- 2026-10-07: task 4 reads the style guide by section from `docs/design/styleguide/` instead of the whole `styleguide.html`.
- 2026-10-07: task 1 done. Price feeds chosen: ECB, Bank of Russia, Coinbase Exchange; results, notes for task 20 and unconfirmed points are in "Trial results".
