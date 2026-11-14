import type Database from 'better-sqlite3';
import { toMinorString, type WishCandidate } from '@budget-buddy/shared';
import { searchClause } from '../modules/transactions/list.js';
import { createValuation } from './valuation.js';

/**
 * The unplanned expenses of a month: confirmed expenses (refunds included)
 * with no envelope and no active link. Uses the aliases `t` (transaction)
 * and `a` (its account).
 */
export const unplannedExpense = `t.kind = 'expense' AND t.status = 'confirmed'
  AND NOT EXISTS (SELECT 1 FROM txn_part e
    WHERE e.txn_id = t.id AND e.envelope_id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM plan_link l
    WHERE l.txn_id = t.id AND l.detached_at IS NULL)`;

type Row = {
  id: bigint;
  merchant: string | null;
  note: string | null;
  date: string;
  accountId: bigint;
  accountName: string;
  categoryName: string | null;
  amount: bigint;
  currency: string;
  fits: bigint;
};

/**
 * Lists the expenses that can be linked to a wish (spec 3a, Design 4): the
 * unplanned ones dated in the wish's month, narrowed by the words of `text`
 * as in the transaction list. An expense fits (O2) when its category is the
 * wish's category, or its merchant is the merchant of an expense already
 * linked to the wish. Fitting ones come first; each group is newest first.
 */
export function listWishCandidates(
  database: Database.Database,
  wish: { id: number; month: string; categoryId: number | null },
  text: string | undefined,
): WishCandidate[] {
  const search = searchClause(database, createValuation(database), text);
  const rows = database
    .prepare(
      `SELECT t.id, t.merchant, t.note, t.date, t.account_id AS accountId,
         a.name AS accountName, c.name AS categoryName, t.amount,
         a.currency,
         COALESCE((? IS NOT NULL AND p.category_id = ?)
           OR (t.merchant_key IS NOT NULL AND t.merchant_key IN (
             SELECT o.merchant_key FROM plan_link k
               JOIN txn o ON o.id = k.txn_id
             WHERE k.wish_id = ? AND k.detached_at IS NULL
               AND o.merchant_key IS NOT NULL)), 0) AS fits
       FROM txn t
         JOIN account a ON a.id = t.account_id
         LEFT JOIN account ta ON ta.id = t.to_account_id
         LEFT JOIN txn_part p ON p.txn_id = t.id AND p.position = 1
         LEFT JOIN category c ON c.id = p.category_id
       WHERE ${unplannedExpense}
         AND substr(t.date, 1, 7) = ?
         ${search ? `AND (${search.sql})` : ''}
       ORDER BY fits DESC, t.date DESC, t.id DESC`,
    )
    .all(
      wish.categoryId,
      wish.categoryId,
      wish.id,
      wish.month,
      ...(search ? search.params : []),
    ) as Row[];
  return rows.map((row) => ({
    transactionId: Number(row.id),
    merchant: row.merchant,
    note: row.note,
    date: row.date,
    accountId: Number(row.accountId),
    accountName: row.accountName,
    categoryName: row.categoryName,
    amount: toMinorString(row.amount),
    currency: row.currency,
    fits: row.fits === 1n,
  }));
}
