import type Database from 'better-sqlite3';
import { formatMinorDecimal, getCurrency } from '@budget-buddy/shared';
import type { CsvCell } from './csv.js';

/** How one database column is written to a cell. */
export type ColumnKind =
  /** The value as it is stored. */
  | 'text'
  /** `true` or `false` for a 0 or 1 flag. */
  | 'flag'
  /** An epoch-millisecond instant as ISO 8601 in UTC; empty when null. */
  | 'instant'
  /** Minor units as a decimal string in a currency of the file (money rules). */
  | 'amount'
  /** A currency of the file, written beside its amounts; not a column. */
  | 'currency';

/** One column of an export file: its header and the column it is read from. */
export interface ExportColumn {
  /** Header in the CSV file. */
  header: string;
  /** Column of the file's table; null for the account's currency. */
  column: string | null;
  kind: ColumnKind;
  /** Key in the file's `currencies` that gives an amount's currency. */
  currency?: string;
}

/**
 * One CSV file of the export (BKP-3). Only the columns listed are ever read:
 * there is no `SELECT *`, so a column added to the database later stays out
 * of the export until it is listed here on purpose (SEC-6).
 */
export interface ExportFile {
  name: string;
  /** The table it is read from. */
  table: string;
  /** SQL ordering that makes the file the same on every run. */
  orderBy: string;
  /**
   * `rows` writes one row per table row. `pairs` writes one `setting,value`
   * row per listed column of the table's single row.
   */
  layout: 'rows' | 'pairs';
  /**
   * The currencies of the file's amounts: a key, and a SQL expression of the
   * row (alias `t`) that gives the currency code. An `amount` column names its
   * key; a `currency` column writes the code beside it.
   */
  currencies?: Readonly<Record<string, string>>;
  columns: readonly ExportColumn[];
}

const text = (name: string, header = name): ExportColumn => ({
  header,
  column: name,
  kind: 'text',
});
const flag = (name: string): ExportColumn => ({
  header: name,
  column: name,
  kind: 'flag',
});
const instant = (name: string): ExportColumn => ({
  header: name,
  column: name,
  kind: 'instant',
});
const amount = (name: string, currency: string): ExportColumn => ({
  header: name,
  column: name,
  kind: 'amount',
  currency,
});
const currency = (source: string, header = 'currency'): ExportColumn => ({
  header,
  column: null,
  kind: 'currency',
  currency: source,
});
/** The currency of the account that a column of the table points to. */
const currencyOfAccount = (column: string) =>
  `(SELECT a.currency FROM account a WHERE a.id = t.${column})`;
/** The currency of the envelope that a column of the table points to. */
const currencyOfEnvelope = (column: string) =>
  `(SELECT e.currency FROM envelope e WHERE e.id = t.${column})`;

/** Every file of the export zip, with the exact columns each one writes. */
export const exportFiles: readonly ExportFile[] = [
  {
    name: 'members.csv',
    table: 'member',
    orderBy: 'id',
    layout: 'rows',
    columns: [
      text('id'),
      text('name'),
      flag('active'),
      instant('created_at'),
      instant('deactivated_at'),
    ],
  },
  {
    name: 'accounts.csv',
    table: 'account',
    orderBy: 'id',
    layout: 'rows',
    columns: [
      text('id'),
      text('name'),
      text('owner_member_id'),
      text('type'),
      text('currency'),
      flag('active'),
      instant('deactivated_at'),
      text('created_by'),
      instant('created_at'),
      text('updated_by'),
      instant('updated_at'),
    ],
  },
  {
    name: 'snapshots.csv',
    table: 'snapshot',
    orderBy: 'id',
    layout: 'rows',
    currencies: { account: currencyOfAccount('account_id') },
    columns: [
      text('id'),
      text('account_id'),
      instant('taken_at'),
      amount('amount', 'account'),
      currency('account'),
      text('source'),
      text('checkin_id'),
      text('source_ref'),
      text('external_id'),
      text('created_by'),
      instant('created_at'),
      text('updated_by'),
      instant('updated_at'),
    ],
  },
  {
    name: 'snapshot_revisions.csv',
    table: 'snapshot_revision',
    orderBy: 'id',
    layout: 'rows',
    currencies: { account: currencyOfAccount('account_id') },
    columns: [
      text('id'),
      text('snapshot_id'),
      text('account_id'),
      text('action'),
      amount('old_amount', 'account'),
      currency('account'),
      instant('old_taken_at'),
      text('changed_by'),
      instant('changed_at'),
    ],
  },
  {
    name: 'checkins.csv',
    table: 'checkin',
    orderBy: 'id',
    layout: 'rows',
    columns: [
      text('id'),
      instant('opened_at'),
      text('opened_by'),
      text('schedule_slot'),
      instant('closed_at'),
      text('closed_by'),
    ],
  },
  {
    name: 'categories.csv',
    table: 'category',
    orderBy: 'id',
    layout: 'rows',
    columns: [
      text('id'),
      text('name'),
      text('kind'),
      text('default_envelope_id'),
      text('position'),
      instant('archived_at'),
      text('created_by'),
      instant('created_at'),
      text('updated_by'),
      instant('updated_at'),
    ],
  },
  {
    name: 'envelopes.csv',
    table: 'envelope',
    orderBy: 'id',
    layout: 'rows',
    currencies: { envelope: 't.currency' },
    columns: [
      text('id'),
      text('name'),
      text('currency'),
      amount('starting_balance', 'envelope'),
      text('starting_month'),
      text('topup_from_month'),
      text('default_category_id'),
      text('position'),
      instant('archived_at'),
      text('created_by'),
      instant('created_at'),
      text('updated_by'),
      instant('updated_at'),
    ],
  },
  {
    name: 'envelope_plans.csv',
    table: 'envelope_plan',
    orderBy: 'id',
    layout: 'rows',
    currencies: { envelope: currencyOfEnvelope('envelope_id') },
    columns: [
      text('id'),
      text('envelope_id'),
      text('from_month'),
      amount('monthly_amount', 'envelope'),
      currency('envelope'),
      text('mode'),
      text('created_by'),
      instant('created_at'),
    ],
  },
  {
    name: 'envelope_topups.csv',
    table: 'envelope_topup',
    orderBy: 'id',
    layout: 'rows',
    currencies: { envelope: currencyOfEnvelope('envelope_id') },
    columns: [
      text('id'),
      text('envelope_id'),
      text('month'),
      amount('amount', 'envelope'),
      currency('envelope'),
      text('mode'),
      instant('created_at'),
    ],
  },
  {
    name: 'envelope_adjustments.csv',
    table: 'envelope_adjustment',
    orderBy: 'id',
    layout: 'rows',
    currencies: { envelope: currencyOfEnvelope('envelope_id') },
    columns: [
      text('id'),
      text('envelope_id'),
      text('date'),
      amount('amount', 'envelope'),
      currency('envelope'),
      text('note'),
      text('move_id'),
      text('created_by'),
      instant('created_at'),
    ],
  },
  {
    name: 'transactions.csv',
    table: 'txn',
    orderBy: 'id',
    layout: 'rows',
    currencies: {
      account: currencyOfAccount('account_id'),
      toAccount: currencyOfAccount('to_account_id'),
    },
    columns: [
      text('id'),
      text('client_id'),
      text('kind'),
      text('status'),
      text('date'),
      text('account_id'),
      amount('amount', 'account'),
      currency('account'),
      text('to_account_id'),
      amount('to_amount', 'toAccount'),
      currency('toAccount', 'to_currency'),
      text('member_id'),
      text('merchant'),
      text('note'),
      text('source'),
      text('source_ref'),
      text('external_id'),
      instant('entered_at'),
      text('created_by'),
      instant('created_at'),
      text('updated_by'),
      instant('updated_at'),
    ],
  },
  {
    name: 'transaction_parts.csv',
    table: 'txn_part',
    orderBy: 'id',
    layout: 'rows',
    currencies: {
      account:
        '(SELECT a.currency FROM txn x JOIN account a ON a.id = x.account_id WHERE x.id = t.txn_id)',
      envelope: currencyOfEnvelope('envelope_id'),
    },
    columns: [
      text('id'),
      text('txn_id'),
      text('position'),
      amount('amount', 'account'),
      currency('account'),
      text('category_id'),
      text('envelope_id'),
      amount('envelope_amount', 'envelope'),
      currency('envelope', 'envelope_currency'),
      flag('envelope_amount_manual'),
    ],
  },
  {
    name: 'transaction_revisions.csv',
    table: 'txn_revision',
    orderBy: 'id',
    layout: 'rows',
    columns: [
      text('id'),
      text('txn_id'),
      text('action'),
      text('changes'),
      text('changed_by'),
      instant('changed_at'),
    ],
  },
  {
    name: 'rules.csv',
    table: 'rule',
    orderBy: 'position',
    layout: 'rows',
    columns: [
      text('id'),
      text('position'),
      text('pattern'),
      text('category_id'),
      text('envelope_id'),
      text('account_id'),
      text('created_by'),
      instant('created_at'),
      text('updated_by'),
      instant('updated_at'),
    ],
  },
  {
    name: 'rates.csv',
    table: 'rate',
    orderBy: 'date, base, quote',
    layout: 'rows',
    columns: [
      text('base'),
      text('quote'),
      text('date'),
      text('rate'),
      text('source'),
      instant('fetched_at'),
    ],
  },
  {
    name: 'coins.csv',
    table: 'coin',
    orderBy: 'code',
    layout: 'rows',
    columns: [
      text('code'),
      text('name'),
      text('decimals'),
      text('feed_id'),
      instant('created_at'),
    ],
  },
  {
    name: 'settings.csv',
    table: 'family',
    orderBy: 'id',
    layout: 'pairs',
    columns: [
      text('common_currency'),
      text('time_zone'),
      text('cadence_kind'),
      text('cadence_day_of_month'),
      text('cadence_every_weeks'),
      text('cadence_weekday'),
      text('cadence_time'),
      text('cadence_anchor_date'),
      text('followup_days'),
      instant('created_at'),
    ],
  },
];

/**
 * Database columns that the export leaves out on purpose, by table, and why.
 * A table or column that is neither exported nor listed here fails the test
 * that compares the schema with the export, so nothing is added to the export
 * or left out of it by accident (SEC-6).
 */
export const exportExclusions: Readonly<
  Record<string, { columns: readonly string[]; reason: string } | 'table'>
> = {
  family: {
    columns: [
      'id',
      'password_hash',
      'password_epoch',
      'failed_signins',
      'locked_until',
    ],
    reason: 'The password hash and sign-in state are secrets (SEC-6).',
  },
  rate: {
    columns: ['id'],
    reason: 'A row number; the base, quote and date identify a rate.',
  },
  txn: {
    columns: ['client_hash', 'merchant_key'],
    reason:
      'A retry fingerprint and a search key derived from the merchant; neither is data the family entered.',
  },
  device: 'table',
  session: 'table',
  passkey: 'table',
  push_subscription: 'table',
  rate_fetch: 'table',
  job_run: 'table',
  notification: 'table',
  backup: 'table',
};

/** Header line of a file: the settings layout has its own two columns. */
export function headerOf(file: ExportFile): readonly string[] {
  return file.layout === 'pairs'
    ? ['setting', 'value']
    : file.columns.map(({ header }) => header);
}

/**
 * Reads every row of a file as cells. Amounts are exact decimal strings in
 * the account's currency, such as `-1986.30`; instants are ISO 8601 in UTC.
 * @throws {Error} if an amount belongs to a currency that is not known.
 */
export function readRows(
  database: Database.Database,
  file: ExportFile,
): CsvCell[][] {
  const reads = file.columns.filter(({ column }) => column !== null);
  const selected = reads.map(({ column }) => `t.${column}`);
  const sources = Object.entries(file.currencies ?? {});
  for (const [, expression] of sources) selected.push(expression);
  const rows = database
    .prepare(
      `SELECT ${selected.join(', ')} FROM ${file.table} t ORDER BY ${file.orderBy}`,
    )
    .raw(true)
    .safeIntegers(true)
    .all() as CsvCell[][];
  const decimals = decimalsOfCurrencies(database);

  if (file.layout === 'pairs') {
    const [row] = rows;
    if (!row) return [];
    return reads.map((column, index) => [
      column.header,
      cell(column, row[index] ?? null, null, decimals),
    ]);
  }
  return rows.map((row) => {
    const codeOf = (column: ExportColumn): string | null => {
      const at = sources.findIndex(([key]) => key === column.currency);
      return at < 0
        ? null
        : ((row[reads.length + at] as string | null) ?? null);
    };
    return file.columns.map((column) =>
      column.kind === 'currency'
        ? codeOf(column)
        : cell(
            column,
            row[reads.indexOf(column)] ?? null,
            codeOf(column),
            decimals,
          ),
    );
  });
}

/** Turns one stored value into a cell. */
function cell(
  column: ExportColumn,
  value: CsvCell,
  currencyCode: string | null,
  decimals: (code: string) => number,
): CsvCell {
  if (value === null) return null;
  switch (column.kind) {
    case 'flag':
      return value === 0n || value === 0 ? 'false' : 'true';
    case 'instant':
      return new Date(Number(value)).toISOString();
    case 'amount':
      if (!currencyCode) throw new Error('An amount has no currency.');
      return formatMinorDecimal(BigInt(value), decimals(currencyCode));
    default:
      return typeof value === 'string' ? safeText(value) : value;
  }
}

/**
 * Keeps a spreadsheet from running text as a formula: text that starts with
 * `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe.
 * Amounts and dates are written by their own kinds and never start that way
 * except a minus sign, which is data and stays.
 */
function safeText(value: string): string {
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}

/** Looks up a currency's decimals: the ISO table, else the `coin` table. */
function decimalsOfCurrencies(
  database: Database.Database,
): (code: string) => number {
  const coins = (
    database.prepare('SELECT code, name, decimals FROM coin').all() as Array<{
      code: string;
      name: string;
      decimals: bigint | number;
    }>
  ).map((coin) => ({ ...coin, decimals: Number(coin.decimals) }));
  return (code) => {
    const found = getCurrency(code, coins);
    if (!found) throw new Error(`Unknown currency: ${code}`);
    return found.decimals;
  };
}
