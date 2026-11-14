import type Database from 'better-sqlite3';
import {
  convert,
  getCurrency,
  toMinorString,
  type CoinCurrency,
  type Currency,
  type RateLookup,
  type RevisionLink,
  type TransactionChanges,
  type WishState,
} from '@budget-buddy/shared';
import { createRateLookup } from '../rates/lookup.js';
import { lookupCurrency } from './currencies.js';

/**
 * A transaction's active link to a wish (spec 3a, Design 1), with the wish's
 * name, currency and month as they are now. `amount` is in the wish's minor
 * units; null means its rate is missing.
 */
export interface StoredLink {
  id: number;
  wishId: number;
  wishName: string;
  wishCurrency: string;
  wishMonth: string;
  wishState: WishState;
  /** The month of the expense's date, kept in step with it. */
  month: string;
  amount: bigint | null;
  amountManual: boolean;
  madeHow: 'recorded' | 'member';
  madeBy: number | null;
  madeAt: number;
}

type LinkRow = {
  id: bigint;
  wishId: bigint;
  wishName: string;
  wishCurrency: string;
  wishMonth: string;
  wishState: WishState;
  month: string;
  amount: bigint | null;
  amountManual: bigint;
  madeHow: 'recorded' | 'member';
  madeBy: bigint | null;
  madeAt: bigint;
};

const linkSelect = `
  SELECT l.id, l.wish_id AS wishId, w.name AS wishName,
    w.currency AS wishCurrency, w.month AS wishMonth, w.state AS wishState,
    l.month, l.amount, l.amount_manual AS amountManual,
    l.made_how AS madeHow, l.made_by AS madeBy, l.made_at AS madeAt
  FROM plan_link l JOIN wish w ON w.id = l.wish_id
  WHERE l.kind = 'wish' AND l.detached_at IS NULL`;

function toLink(row: LinkRow): StoredLink {
  return {
    id: Number(row.id),
    wishId: Number(row.wishId),
    wishName: row.wishName,
    wishCurrency: row.wishCurrency,
    wishMonth: row.wishMonth,
    wishState: row.wishState,
    month: row.month,
    amount: row.amount,
    amountManual: row.amountManual === 1n,
    madeHow: row.madeHow,
    madeBy: row.madeBy === null ? null : Number(row.madeBy),
    madeAt: Number(row.madeAt),
  };
}

/** The active link of a transaction, or null. */
export function readLink(
  database: Database.Database,
  txnId: number,
): StoredLink | null {
  const row = database.prepare(`${linkSelect} AND l.txn_id = ?`).get(txnId) as
    LinkRow | undefined;
  return row ? toLink(row) : null;
}

/** What a revision records of a link (Design 6). */
export function linkSnapshot(link: StoredLink): RevisionLink {
  return {
    kind: 'wish',
    wishId: link.wishId,
    name: link.wishName,
    madeHow: link.madeHow,
  };
}

/**
 * Converts an expense amount into a wish's currency (Design 3): equal for
 * the same currency, else `convert` at the rate of `date` or the nearest
 * earlier one, rounded once. Null when no rate exists yet; the rates
 * service fills it later (`fillPendingLinkAmounts`).
 * @throws {Error} if a stored currency code is unknown.
 */
export function linkAmountFor(
  database: Database.Database,
  lookup: RateLookup,
  input: {
    amount: bigint;
    currency: string;
    wishCurrency: string;
    date: string;
  },
): bigint | null {
  const from = known(database, input.currency);
  const to = known(database, input.wishCurrency);
  const result = convert(input.amount, from, to, input.date, lookup);
  return 'missing' in result ? null : result.value;
}

function known(database: Database.Database, code: string): Currency {
  const currency = lookupCurrency(database, code);
  if (!currency) throw new Error(`Unknown stored currency ${code}.`);
  return currency;
}

/**
 * The link fields of a revision for a change from `before` to `after`
 * (Design 6): `link` when the wish changes, `linkAmount` and its flag when
 * a link is made, moved, removed or its amount is corrected. An amount that
 * only follows the expense in the wish's own currency is not logged.
 */
export function linkChanges(
  before: StoredLink | null,
  after: StoredLink | null,
  currency: string,
): TransactionChanges {
  const changes: TransactionChanges = {};
  const minor = (link: StoredLink | null) =>
    link === null || link.amount === null ? null : toMinorString(link.amount);
  const sameWish =
    before !== null && after !== null && before.wishId === after.wishId;
  if (!sameWish) {
    if (before === null && after === null) return changes;
    changes.link = [
      before === null ? null : linkSnapshot(before),
      after === null ? null : linkSnapshot(after),
    ];
  } else if (
    before.wishCurrency === currency &&
    after.wishCurrency === currency &&
    before.amountManual === after.amountManual
  ) {
    return changes;
  }
  const amounts: [string | null, string | null] = [minor(before), minor(after)];
  const manual: [boolean | null, boolean | null] = [
    before === null ? null : before.amountManual,
    after === null ? null : after.amountManual,
  ];
  if (amounts[0] !== amounts[1]) changes.linkAmount = amounts;
  if (manual[0] !== manual[1]) changes.linkAmountManual = manual;
  if (sameWish && (changes.linkAmount || changes.linkAmountManual)) {
    changes.linkWish = { wishId: after.wishId, name: after.wishName };
  }
  return changes;
}

/**
 * Writes the difference between a transaction's old and new link: a removed
 * link is deleted, a new or moved one inserted (made by `memberId`), and the
 * same wish keeps its row with the new amount and month.
 */
export function saveLink(
  database: Database.Database,
  txnId: number,
  before: StoredLink | null,
  after: StoredLink | null,
): void {
  if (before !== null && after !== null && before.wishId === after.wishId) {
    database
      .prepare(
        `UPDATE plan_link SET month = ?, amount = ?, amount_manual = ?
         WHERE id = ?`,
      )
      .run(after.month, after.amount, after.amountManual ? 1 : 0, before.id);
    return;
  }
  if (before !== null) {
    database.prepare('DELETE FROM plan_link WHERE id = ?').run(before.id);
  }
  if (after !== null) {
    database
      .prepare(
        `INSERT INTO plan_link (txn_id, kind, wish_id, month, amount,
           amount_manual, made_how, made_by, made_at)
         VALUES (?, 'wish', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        txnId,
        after.wishId,
        after.month,
        after.amount,
        after.amountManual ? 1 : 0,
        after.madeHow,
        after.madeBy,
        after.madeAt,
      );
  }
}

type PendingRow = {
  id: bigint;
  amount: bigint;
  date: string;
  accountCurrency: string;
  wishCurrency: string;
};

/**
 * Converts the link amounts still missing because no rate existed when the
 * expense was linked (Design 3), at the rate of the expense's date or the
 * nearest earlier one, rounded once. Run after new rates are stored and at
 * start, as `fillPendingEnvelopeAmounts` is.
 * @returns The number of links filled.
 */
export function fillPendingLinkAmounts(database: Database.Database): number {
  const pending = database
    .prepare(
      `SELECT l.id, t.amount, t.date, a.currency AS accountCurrency,
         w.currency AS wishCurrency
       FROM plan_link l
         JOIN txn t ON t.id = l.txn_id
         JOIN account a ON a.id = t.account_id
         JOIN wish w ON w.id = l.wish_id
       WHERE l.amount IS NULL AND l.detached_at IS NULL`,
    )
    .all() as PendingRow[];
  if (pending.length === 0) return 0;
  const coins = (
    database.prepare('SELECT code, name, decimals FROM coin').all() as Array<{
      code: string;
      name: string;
      decimals: bigint;
    }>
  ).map((coin): CoinCurrency => ({ ...coin, decimals: Number(coin.decimals) }));
  const currency = (code: string) => getCurrency(code, coins);
  const lookup = createRateLookup(database);
  // Only while still missing, so a value typed meanwhile is never replaced.
  const update = database.prepare(
    'UPDATE plan_link SET amount = ? WHERE id = ? AND amount IS NULL',
  );
  return database.transaction(() => {
    let filled = 0;
    for (const row of pending) {
      const from = currency(row.accountCurrency);
      const to = currency(row.wishCurrency);
      if (!from || !to) continue;
      const result = convert(row.amount, from, to, row.date, lookup);
      if ('missing' in result) continue;
      filled += update.run(result.value, row.id).changes;
    }
    return filled;
  })();
}
