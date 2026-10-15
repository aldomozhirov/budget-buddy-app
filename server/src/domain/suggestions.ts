import type Database from 'better-sqlite3';
import {
  addLocalDays,
  foldText,
  matchRule,
  merchantKey,
  type AddOptionsAccount,
} from '@budget-buddy/shared';
import { lookupCurrency } from './currencies.js';
import { loadRules } from './rules.js';

/** Length of the window "most used" is counted in (Design 3.6, 3.7). */
export const RECENT_DAYS = 90;

/** At most this many category chips are suggested (Design 3.6). */
export const CATEGORY_CHIP_COUNT = 4;

/** First date of the "last 90 days" window that ends today. */
export function recentSince(today: string, timeZone: string): string {
  return addLocalDays(today, -RECENT_DAYS, timeZone);
}

/** Orders ids by count, highest first; ties keep the order of `ids`. */
function byCount(ids: readonly number[], counts: Map<number, number>) {
  return ids
    .filter((id) => (counts.get(id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
}

/**
 * Counts the confirmed transaction parts per category. Only confirmed
 * transactions count (Design 3.6); `where` narrows them further.
 */
function categoryCounts(
  database: Database.Database,
  where: string,
  params: (string | number)[],
): Map<number, number> {
  const rows = database
    .prepare(
      `SELECT p.category_id AS id, COUNT(*) AS n
         FROM txn_part p JOIN txn t ON t.id = p.txn_id
        WHERE t.status = 'confirmed' AND p.category_id IS NOT NULL
          AND ${where}
        GROUP BY p.category_id`,
    )
    .all(...params) as { id: bigint; n: bigint }[];
  return new Map(rows.map((row) => [Number(row.id), Number(row.n)]));
}

/** An active category's id and kind, in list order. */
function activeCategories(database: Database.Database) {
  return (
    database
      .prepare(
        `SELECT id, kind FROM category
          WHERE archived_at IS NULL ORDER BY position, id`,
      )
      .all() as { id: bigint; kind: 'expense' | 'income' }[]
  ).map((row) => ({ id: Number(row.id), kind: row.kind }));
}

/**
 * Orders every active category for one profile (Design 3.6, without a
 * merchant or an envelope): the profile's most used in the last 90 days,
 * then the family's, then list order.
 */
export function orderCategories(
  database: Database.Database,
  context: { memberId: number; today: string; timeZone: string },
): number[] {
  const ids = activeCategories(database).map((category) => category.id);
  const since = recentSince(context.today, context.timeZone);
  const own = categoryCounts(database, 't.created_by = ? AND t.date >= ?', [
    context.memberId,
    since,
  ]);
  const family = categoryCounts(database, 't.date >= ?', [since]);
  const position = new Map(ids.map((id, index) => [id, index]));
  return [...ids].sort(
    (a, b) =>
      (own.get(b) ?? 0) - (own.get(a) ?? 0) ||
      (family.get(b) ?? 0) - (family.get(a) ?? 0) ||
      (position.get(a) ?? 0) - (position.get(b) ?? 0),
  );
}

/**
 * The category chips for the Add form (CAT-5; Design 3.6, O8): up to four
 * active categories of the kind, without duplicates. A matching rule's
 * category comes first, then the categories most often used with the same
 * merchant key, then with the chosen envelope, then the profile's most used
 * in the last 90 days, then the family's, then list order.
 */
export function suggestCategories(
  database: Database.Database,
  query: {
    kind: 'expense' | 'income';
    merchant?: string | undefined;
    envelopeId?: number | undefined;
    accountId?: number | undefined;
    memberId: number;
    today: string;
    timeZone: string;
  },
): number[] {
  const ofKind = activeCategories(database)
    .filter((category) => category.kind === query.kind)
    .map((category) => category.id);
  const result: number[] = [];
  const add = (ids: readonly number[]) => {
    for (const id of ids) {
      if (result.length >= CATEGORY_CHIP_COUNT) return;
      if (ofKind.includes(id) && !result.includes(id)) result.push(id);
    }
  };

  const merchant = query.merchant?.trim() ?? '';
  if (query.kind === 'expense' && merchant !== '') {
    const match = matchRule(
      merchant,
      query.accountId ?? null,
      loadRules(database),
    );
    if (match) add([match.categoryId]);
  }
  const key = merchantKey(merchant);
  if (key !== '') {
    add(byCount(ofKind, categoryCounts(database, 't.merchant_key = ?', [key])));
  }
  if (query.envelopeId !== undefined) {
    add(
      byCount(
        ofKind,
        categoryCounts(database, 'p.envelope_id = ?', [query.envelopeId]),
      ),
    );
  }
  const since = recentSince(query.today, query.timeZone);
  add(
    byCount(
      ofKind,
      categoryCounts(database, 't.created_by = ? AND t.date >= ?', [
        query.memberId,
        since,
      ]),
    ),
  );
  add(byCount(ofKind, categoryCounts(database, 't.date >= ?', [since])));
  add(ofKind);
  return result;
}

/** Sort rank of an account type: bank before cash before the rest. */
function typeRank(type: string): number {
  return type === 'bank' ? 0 : type === 'cash' ? 1 : 2;
}

/**
 * The active accounts in the profile's order (Design 3.7; O15). First the
 * accounts the profile entered most expenses on in the last 90 days, ties
 * broken by the latest use, so the first is the default account. Then those
 * never used by it: its own accounts before everyone else's, bank before
 * cash, then by name.
 */
export function orderedAccounts(
  database: Database.Database,
  context: { memberId: number; today: string; timeZone: string },
): AddOptionsAccount[] {
  const rows = database
    .prepare(
      `SELECT a.id, a.name, a.owner_member_id AS ownerMemberId,
              m.name AS ownerName, a.type, a.currency
         FROM account a LEFT JOIN member m ON m.id = a.owner_member_id
        WHERE a.active = 1`,
    )
    .all() as {
    id: bigint;
    name: string;
    ownerMemberId: bigint | null;
    ownerName: string | null;
    type: AddOptionsAccount['type'];
    currency: string;
  }[];
  const usage = new Map(
    (
      database
        .prepare(
          `SELECT account_id AS id, COUNT(*) AS n, MAX(date) AS lastDate,
                  MAX(id) AS lastId
             FROM txn
            WHERE kind = 'expense' AND status = 'confirmed'
              AND created_by = ? AND date >= ?
            GROUP BY account_id`,
        )
        .all(
          context.memberId,
          recentSince(context.today, context.timeZone),
        ) as { id: bigint; n: bigint; lastDate: string; lastId: bigint }[]
    ).map((row) => [Number(row.id), row] as const),
  );

  const accounts = rows.map((row): AddOptionsAccount => {
    const currency = lookupCurrency(database, row.currency);
    return {
      id: Number(row.id),
      name: row.name,
      ownerMemberId:
        row.ownerMemberId === null ? null : Number(row.ownerMemberId),
      ownerName: row.ownerName,
      type: row.type,
      currency: row.currency,
      decimals: currency?.decimals ?? 2,
      symbol: currency?.symbol ?? row.currency,
    };
  });
  const own = (account: AddOptionsAccount) =>
    account.ownerMemberId === context.memberId ? 0 : 1;
  return accounts.sort((a, b) => {
    const left = usage.get(a.id);
    const right = usage.get(b.id);
    if (left || right) {
      if (!left) return 1;
      if (!right) return -1;
      return (
        Number(right.n - left.n) ||
        right.lastDate.localeCompare(left.lastDate) ||
        Number(right.lastId - left.lastId)
      );
    }
    return (
      own(a) - own(b) ||
      typeRank(a.type) - typeRank(b.type) ||
      foldText(a.name).localeCompare(foldText(b.name)) ||
      a.id - b.id
    );
  });
}
