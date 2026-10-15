import type Database from 'better-sqlite3';
import {
  convert,
  exchangeRate,
  toMinorString,
  type Currency,
  type RateLookup,
  type Transaction,
  type TransactionChanges,
  type TransactionKind,
} from '@budget-buddy/shared';
import { lookupCurrency, rescaleMinor } from './currencies.js';

/**
 * A transaction as stored, with its one part (D5) and the currencies of its
 * accounts and envelope. Amounts are minor units of those currencies.
 */
export interface StoredTransaction {
  id: number;
  clientId: string | null;
  clientHash: string | null;
  kind: TransactionKind;
  status: 'draft' | 'confirmed';
  date: string;
  accountId: number;
  currency: string;
  amount: bigint;
  toAccountId: number | null;
  toCurrency: string | null;
  toAmount: bigint | null;
  memberId: number;
  merchant: string | null;
  note: string | null;
  categoryId: number | null;
  envelopeId: number | null;
  envelopeCurrency: string | null;
  envelopeAmount: bigint | null;
  envelopeAmountManual: boolean;
  source: Transaction['source'];
  enteredAt: number | null;
  createdBy: number;
  createdAt: number;
  updatedBy: number;
  updatedAt: number;
}

type Row = {
  [Key in keyof StoredTransaction]: StoredTransaction[Key] extends number
    ? bigint
    : StoredTransaction[Key] extends number | null
      ? bigint | null
      : StoredTransaction[Key] extends boolean
        ? bigint
        : StoredTransaction[Key];
};

/** Reads one transaction with its first part, or undefined. */
export function readTransaction(
  database: Database.Database,
  id: number,
): StoredTransaction | undefined {
  const row = database
    .prepare(
      `SELECT t.id, t.client_id AS clientId, t.client_hash AS clientHash,
         t.kind, t.status, t.date, t.account_id AS accountId,
         a.currency, t.amount, t.to_account_id AS toAccountId,
         ta.currency AS toCurrency, t.to_amount AS toAmount,
         t.member_id AS memberId, t.merchant, t.note,
         p.category_id AS categoryId, p.envelope_id AS envelopeId,
         e.currency AS envelopeCurrency, p.envelope_amount AS envelopeAmount,
         COALESCE(p.envelope_amount_manual, 0) AS envelopeAmountManual,
         t.source, t.entered_at AS enteredAt, t.created_by AS createdBy,
         t.created_at AS createdAt, t.updated_by AS updatedBy,
         t.updated_at AS updatedAt
       FROM txn t
         JOIN account a ON a.id = t.account_id
         LEFT JOIN account ta ON ta.id = t.to_account_id
         LEFT JOIN txn_part p ON p.txn_id = t.id AND p.position = 1
         LEFT JOIN envelope e ON e.id = p.envelope_id
       WHERE t.id = ?`,
    )
    .get(id) as Row | undefined;
  if (!row) return undefined;
  const id_ = (value: bigint | null) => (value === null ? null : Number(value));
  return {
    ...row,
    id: Number(row.id),
    accountId: Number(row.accountId),
    toAccountId: id_(row.toAccountId),
    memberId: Number(row.memberId),
    categoryId: id_(row.categoryId),
    envelopeId: id_(row.envelopeId),
    envelopeAmountManual: row.envelopeAmountManual === 1n,
    enteredAt: id_(row.enteredAt),
    createdBy: Number(row.createdBy),
    createdAt: Number(row.createdAt),
    updatedBy: Number(row.updatedBy),
    updatedAt: Number(row.updatedAt),
  };
}

/**
 * Converts an expense part's amount to its envelope's currency (Design 3.3):
 * equal for the same currency, else with `convert` at the rate of `date` or
 * the nearest earlier one, rounded once. Null when no rate exists yet; the
 * rates service fills it later (`fillPendingEnvelopeAmounts`).
 * @throws {Error} if a stored currency code is unknown.
 */
export function envelopeAmountFor(
  database: Database.Database,
  lookup: RateLookup,
  input: {
    amount: bigint;
    currency: string;
    envelopeCurrency: string;
    date: string;
  },
): bigint | null {
  const from = knownCurrency(database, input.currency);
  const to = knownCurrency(database, input.envelopeCurrency);
  const result = convert(input.amount, from, to, input.date, lookup);
  return 'missing' in result ? null : result.value;
}

/**
 * The transaction as the API returns it. A converted envelope amount comes
 * with the rate it was converted at, read through the same path as
 * `convert` (UI-TXN-5); none for the same currency, a missing amount or one
 * typed by hand. Rates are only added, so this is the rate used unless a
 * rate for an earlier gap day was stored after the expense was saved.
 */
export function toTransactionResponse(
  stored: StoredTransaction,
  lookup: RateLookup,
): Transaction {
  const rate =
    stored.envelopeCurrency !== null &&
    stored.envelopeCurrency !== stored.currency &&
    stored.envelopeAmount !== null &&
    !stored.envelopeAmountManual
      ? exchangeRate(
          stored.currency,
          stored.envelopeCurrency,
          stored.date,
          lookup,
        )
      : undefined;
  const minor = (value: bigint | null) =>
    value === null ? null : toMinorString(value);
  return {
    id: stored.id,
    clientId: stored.clientId,
    kind: stored.kind,
    status: stored.status,
    date: stored.date,
    accountId: stored.accountId,
    currency: stored.currency,
    amount: toMinorString(stored.amount),
    toAccountId: stored.toAccountId,
    toCurrency: stored.toCurrency,
    toAmount: minor(stored.toAmount),
    memberId: stored.memberId,
    merchant: stored.merchant,
    note: stored.note,
    categoryId: stored.categoryId,
    envelopeId: stored.envelopeId,
    envelopeCurrency: stored.envelopeCurrency,
    envelopeAmount: minor(stored.envelopeAmount),
    envelopeAmountManual: stored.envelopeAmountManual,
    envelopeRate:
      rate && stored.envelopeCurrency !== null
        ? {
            from: stored.currency,
            to: stored.envelopeCurrency,
            rate: rate.rate,
            date: rate.date,
          }
        : null,
    source: stored.source,
    enteredAt: stored.enteredAt,
    createdBy: stored.createdBy,
    createdAt: stored.createdAt,
    updatedBy: stored.updatedBy,
    updatedAt: stored.updatedAt,
  };
}

/** The fields a revision records (Design 3.9), in their JSON form. */
type RevisionValues = {
  [Key in keyof Required<TransactionChanges>]: NonNullable<
    TransactionChanges[Key]
  >[0];
};

function revisionValues(stored: StoredTransaction): RevisionValues {
  const minor = (value: bigint | null) =>
    value === null ? null : toMinorString(value);
  return {
    clientId: stored.clientId,
    kind: stored.kind,
    status: stored.status,
    date: stored.date,
    accountId: stored.accountId,
    amount: toMinorString(stored.amount),
    toAccountId: stored.toAccountId,
    toAmount: minor(stored.toAmount),
    memberId: stored.memberId,
    merchant: stored.merchant,
    note: stored.note,
    categoryId: stored.categoryId,
    envelopeId: stored.envelopeId,
    envelopeAmount: minor(stored.envelopeAmount),
    envelopeAmountManual: stored.envelopeAmountManual,
    source: stored.source,
    enteredAt: stored.enteredAt,
    createdBy: stored.createdBy,
    createdAt: stored.createdAt,
  };
}

/**
 * The fields that differ between two states of a transaction, as
 * `{field: [old, new]}`; empty when nothing changed.
 */
export function changedFields(
  before: StoredTransaction,
  after: StoredTransaction,
): TransactionChanges {
  const old = revisionValues(before);
  const next = revisionValues(after);
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(old) as (keyof RevisionValues)[]) {
    if (old[key] !== next[key]) changes[key] = [old[key], next[key]];
  }
  return changes as TransactionChanges;
}

/** Every field of a deleted transaction, each as `[old, null]`. */
export function deletedFields(stored: StoredTransaction): TransactionChanges {
  const changes: Record<string, [unknown, null]> = {};
  for (const [key, value] of Object.entries(revisionValues(stored))) {
    changes[key] = [value, null];
  }
  return changes as TransactionChanges;
}

/** Stores one revision of a transaction (MEM-5). */
export function writeRevision(
  database: Database.Database,
  revision: {
    txnId: number;
    action: 'update' | 'delete';
    changes: TransactionChanges;
    changedBy: number;
    changedAt: number;
  },
): void {
  database
    .prepare(
      `INSERT INTO txn_revision (txn_id, action, changes, changed_by,
         changed_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      revision.txnId,
      revision.action,
      JSON.stringify(revision.changes),
      revision.changedBy,
      revision.changedAt,
    );
}

/** Why an account's transactions cannot be relabelled to a currency. */
export type RelabelProblem = 'too_large' | 'zero';

/** The prepared relabel of an account's transactions (ACC-5; 3.3). */
export interface TransactionRelabel {
  /** Transactions with an amount on the account. */
  count: number;
  /**
   * Writes the new amounts. Call inside the caller's transaction after the
   * account's currency has changed, so envelope amounts convert from it.
   */
  apply(lookup: RateLookup): void;
}

/**
 * Prepares relabelling an account's transaction amounts from one currency's
 * decimals to another's without converting them, as snapshots are (ACC-5;
 * Design 3.3): each side of a transfer on its own account, the parts, and
 * the amounts that revisions recorded for this account. Every new amount is
 * computed first, so a problem leaves everything untouched. Envelope amounts
 * that were not typed by hand are recomputed when applied.
 */
export function prepareTransactionRelabel(
  database: Database.Database,
  accountId: number,
  source: Currency,
  target: Currency,
): TransactionRelabel | RelabelProblem {
  const rescale = (amount: bigint) =>
    rescaleMinor(amount, source.decimals, target.decimals);
  const sides = database
    .prepare(
      `SELECT id, account_id = @id AS mine, to_account_id = @id AS theirs,
         amount, to_amount AS toAmount
       FROM txn WHERE account_id = @id OR to_account_id = @id ORDER BY id`,
    )
    .all({ id: accountId }) as Array<{
    id: bigint;
    mine: bigint;
    theirs: bigint | null;
    amount: bigint;
    toAmount: bigint | null;
  }>;
  let updates: Array<{ id: bigint; amount: bigint; toAmount: bigint | null }>;
  let revisions: Array<{ id: bigint; changes: string }>;
  try {
    updates = sides.map((side) => {
      const amount = side.mine === 1n ? rescale(side.amount) : side.amount;
      const toAmount =
        side.theirs === 1n && side.toAmount !== null
          ? rescale(side.toAmount)
          : side.toAmount;
      if (amount === 0n || toAmount === 0n) throw new ZeroAmountError();
      return { id: side.id, amount, toAmount };
    });
    revisions = relabelRevisions(database, accountId, rescale);
  } catch (error) {
    if (error instanceof ZeroAmountError) return 'zero';
    if (error instanceof RangeError) return 'too_large';
    throw error;
  }
  return {
    count: sides.length,
    apply(lookup) {
      const updateTxn = database.prepare(
        'UPDATE txn SET amount = ?, to_amount = ? WHERE id = ?',
      );
      const updatePart = database.prepare(
        'UPDATE txn_part SET amount = ? WHERE txn_id = ?',
      );
      for (const update of updates) {
        updateTxn.run(update.amount, update.toAmount, update.id);
        updatePart.run(update.amount, update.id);
      }
      const updateRevision = database.prepare(
        'UPDATE txn_revision SET changes = ? WHERE id = ?',
      );
      for (const revision of revisions) {
        updateRevision.run(revision.changes, revision.id);
      }
      recomputeEnvelopeAmounts(database, lookup, accountId);
    },
  };
}

class ZeroAmountError extends Error {}

/**
 * Recomputes the envelope amounts of an account's expense parts that were
 * not typed by hand, from the part amounts as they are now.
 */
function recomputeEnvelopeAmounts(
  database: Database.Database,
  lookup: RateLookup,
  accountId: number,
): void {
  const parts = database
    .prepare(
      `SELECT p.id, p.amount, t.date, a.currency,
         e.currency AS envelopeCurrency
       FROM txn_part p
         JOIN txn t ON t.id = p.txn_id
         JOIN account a ON a.id = t.account_id
         JOIN envelope e ON e.id = p.envelope_id
       WHERE t.account_id = ? AND p.envelope_amount_manual = 0`,
    )
    .all(accountId) as Array<{
    id: bigint;
    amount: bigint;
    date: string;
    currency: string;
    envelopeCurrency: string;
  }>;
  const update = database.prepare(
    'UPDATE txn_part SET envelope_amount = ? WHERE id = ?',
  );
  for (const part of parts) {
    update.run(envelopeAmountFor(database, lookup, part), part.id);
  }
}

/**
 * Rescales the amounts that revisions recorded on the account. A revision's
 * amount belongs to the account of the same moment, so each transaction's
 * revisions are walked from the newest, starting from its current accounts
 * (or a delete's old ones) and stepping back through account changes.
 * @returns The revisions whose JSON changes, with the new JSON.
 * @throws {RangeError} if an amount is too large in the new currency.
 */
function relabelRevisions(
  database: Database.Database,
  accountId: number,
  rescale: (amount: bigint) => bigint,
): Array<{ id: bigint; changes: string }> {
  const rows = database
    .prepare(
      `SELECT r.id, r.txn_id AS txnId, r.action, r.changes,
         t.account_id AS accountId, t.to_account_id AS toAccountId
       FROM txn_revision r LEFT JOIN txn t ON t.id = r.txn_id
       WHERE r.txn_id IN (
         SELECT txn_id FROM txn_revision
         WHERE json_extract(changes, '$.accountId[0]') = @id
           OR json_extract(changes, '$.accountId[1]') = @id
           OR json_extract(changes, '$.toAccountId[0]') = @id
           OR json_extract(changes, '$.toAccountId[1]') = @id
         UNION SELECT id FROM txn
         WHERE account_id = @id OR to_account_id = @id)
       ORDER BY r.txn_id, r.id DESC`,
    )
    .all({ id: accountId }) as Array<{
    id: bigint;
    txnId: bigint;
    action: 'update' | 'delete';
    changes: string;
    accountId: bigint | null;
    toAccountId: bigint | null;
  }>;
  const result: Array<{ id: bigint; changes: string }> = [];
  let txnId: bigint | undefined;
  let account: number | null = null;
  let toAccount: number | null = null;
  for (const row of rows) {
    if (row.txnId !== txnId) {
      txnId = row.txnId;
      account = row.accountId === null ? null : Number(row.accountId);
      toAccount = row.toAccountId === null ? null : Number(row.toAccountId);
    }
    const changes = JSON.parse(row.changes) as TransactionChanges;
    // A delete is the newest revision; its old values are the last state.
    type Owners = { account: number | null; toAccount: number | null };
    const after: Owners =
      row.action === 'delete'
        ? { account: null, toAccount: null }
        : { account, toAccount };
    const before: Owners = {
      account: changes.accountId ? changes.accountId[0] : after.account,
      toAccount: changes.toAccountId ? changes.toAccountId[0] : after.toAccount,
    };
    let changed = false;
    const relabel = (
      pair: [string | null, string | null] | undefined,
      owners: [number | null, number | null],
    ) => {
      if (!pair) return;
      for (const index of [0, 1] as const) {
        const value = pair[index];
        if (value !== null && owners[index] === accountId) {
          pair[index] = toMinorString(rescale(BigInt(value)));
          changed = true;
        }
      }
    };
    relabel(changes.amount, [before.account, after.account]);
    relabel(changes.toAmount, [before.toAccount, after.toAccount]);
    if (changed) result.push({ id: row.id, changes: JSON.stringify(changes) });
    account = before.account;
    toAccount = before.toAccount;
  }
  return result;
}

/**
 * Looks up a stored currency code.
 * @throws {Error} if the code is unknown, which stored data never is.
 */
function knownCurrency(database: Database.Database, code: string): Currency {
  const currency = lookupCurrency(database, code);
  if (!currency) throw new Error(`Unknown stored currency ${code}.`);
  return currency;
}
