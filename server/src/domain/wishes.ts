import type Database from 'better-sqlite3';
import {
  toMinorString,
  type Wish,
  type WishState,
  type WishesResponse,
} from '@budget-buddy/shared';
import type { Valuation } from './valuation.js';

type WishRow = {
  id: bigint;
  month: string;
  name: string;
  amount: bigint;
  expression: string | null;
  currency: string;
  categoryId: bigint | null;
  categoryName: string | null;
  note: string | null;
  state: WishState;
  createdBy: bigint;
  createdByName: string;
  createdAt: bigint;
  updatedBy: bigint;
  updatedByName: string;
  updatedAt: bigint;
};

type LinkRow = {
  wishId: bigint;
  transactionId: bigint;
  merchant: string | null;
  note: string | null;
  date: string;
  accountId: bigint;
  accountName: string;
  amount: bigint;
  currency: string;
  linkAmount: bigint | null;
  madeHow: 'recorded' | 'member';
  madeBy: string | null;
};

const wishSelect = `
  SELECT w.id, w.month, w.name, w.amount, w.expression, w.currency,
         w.category_id AS categoryId, c.name AS categoryName, w.note,
         w.state, w.created_by AS createdBy, cm.name AS createdByName,
         w.created_at AS createdAt, w.updated_by AS updatedBy,
         um.name AS updatedByName, w.updated_at AS updatedAt
  FROM wish w
  LEFT JOIN category c ON c.id = w.category_id
  JOIN member cm ON cm.id = w.created_by
  JOIN member um ON um.id = w.updated_by`;

/** Open wishes first, then the rest, each group oldest first (O12). */
const wishOrder = `ORDER BY (w.state <> 'open'), w.created_at, w.id`;

/** Reads the expenses linked to some wishes, newest first. */
function loadLinks(
  database: Database.Database,
  wishIds: bigint[],
): Map<bigint, LinkRow[]> {
  const links = new Map<bigint, LinkRow[]>();
  if (wishIds.length === 0) return links;
  const rows = database
    .prepare(
      `SELECT l.wish_id AS wishId, t.id AS transactionId, t.merchant,
              t.note, t.date, t.account_id AS accountId,
              a.name AS accountName, t.amount, a.currency,
              l.amount AS linkAmount, l.made_how AS madeHow,
              m.name AS madeBy
       FROM plan_link l
       JOIN txn t ON t.id = l.txn_id
       JOIN account a ON a.id = t.account_id
       LEFT JOIN member m ON m.id = l.made_by
       WHERE l.detached_at IS NULL AND l.kind = 'wish'
         AND l.wish_id IN (${wishIds.map(() => '?').join(', ')})
       ORDER BY t.date DESC, t.id DESC`,
    )
    .all(...wishIds) as LinkRow[];
  for (const row of rows) {
    const list = links.get(row.wishId) ?? [];
    list.push(row);
    links.set(row.wishId, list);
  }
  return links;
}

/** Builds the wish the API returns from its row and its links (Design 3). */
function toWish(row: WishRow, links: LinkRow[]): Wish {
  let spent = 0n;
  let incomplete = false;
  for (const link of links) {
    if (link.linkAmount === null) incomplete = true;
    else spent += link.linkAmount;
  }
  const difference = row.amount - spent;
  return {
    id: Number(row.id),
    month: row.month,
    name: row.name,
    amount: toMinorString(row.amount),
    expression: row.expression,
    currency: row.currency,
    categoryId: row.categoryId === null ? null : Number(row.categoryId),
    categoryName: row.categoryName,
    note: row.note,
    state: row.state,
    spent: toMinorString(spent),
    left: toMinorString(difference),
    over: toMinorString(difference < 0n ? -difference : 0n),
    under: toMinorString(
      row.state === 'done' && difference > 0n ? difference : 0n,
    ),
    incomplete,
    expenseCount: links.length,
    expenses: links.map((link) => ({
      transactionId: Number(link.transactionId),
      merchant: link.merchant,
      note: link.note,
      date: link.date,
      accountId: Number(link.accountId),
      accountName: link.accountName,
      amount: toMinorString(link.amount),
      currency: link.currency,
      linkAmount:
        link.linkAmount === null ? null : toMinorString(link.linkAmount),
      madeHow: link.madeHow,
      madeBy: link.madeBy,
    })),
    createdBy: Number(row.createdBy),
    createdByName: row.createdByName,
    createdAt: Number(row.createdAt),
    updatedBy: Number(row.updatedBy),
    updatedByName: row.updatedByName,
    updatedAt: Number(row.updatedAt),
  };
}

/** One wish that is not deleted, with its links; undefined if none. */
export function loadWish(
  database: Database.Database,
  id: number,
): Wish | undefined {
  const row = database
    .prepare(`${wishSelect} WHERE w.id = ? AND w.deleted_at IS NULL`)
    .get(id) as WishRow | undefined;
  if (!row) return undefined;
  return toWish(row, loadLinks(database, [row.id]).get(row.id) ?? []);
}

/** The wishes of a month that are not deleted, in the order of O12. */
export function listWishes(database: Database.Database, month: string): Wish[] {
  const rows = database
    .prepare(
      `${wishSelect} WHERE w.month = ? AND w.deleted_at IS NULL ${wishOrder}`,
    )
    .all(month) as WishRow[];
  const links = loadLinks(
    database,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toWish(row, links.get(row.id) ?? []));
}

/**
 * The month's count of wishes and open ones, and the total of those that
 * are not dropped (Design 3): each currency is summed in its own unit, then
 * converted once to the common currency at the rate of the month's first
 * day, or at the latest stored rate for a month that has not begun.
 */
export function wishesSummary(
  wishes: Wish[],
  month: string,
  currentMonth: string,
  valuation: Valuation,
): Pick<WishesResponse, 'counts' | 'total'> {
  const perCurrency = new Map<string, bigint>();
  for (const wish of wishes) {
    if (wish.state === 'dropped') continue;
    perCurrency.set(
      wish.currency,
      (perCurrency.get(wish.currency) ?? 0n) + BigInt(wish.amount),
    );
  }
  const estimated = month > currentMonth;
  // Dates compare as text, so this is the latest rate there is.
  const date = estimated ? '9999-12-31' : `${month}-01`;
  let total = 0n;
  let incomplete = false;
  for (const [code, amount] of perCurrency) {
    const converted = valuation.toCommon(amount, code, date);
    if (converted === undefined) incomplete = true;
    else total += converted;
  }
  return {
    counts: {
      total: wishes.length,
      open: wishes.filter((wish) => wish.state === 'open').length,
    },
    total: {
      amount: perCurrency.size === 0 ? null : toMinorString(total),
      currency: valuation.commonCurrency.code,
      incomplete,
      estimated: estimated && perCurrency.size > 0,
    },
  };
}
