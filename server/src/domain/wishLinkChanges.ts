import type Database from 'better-sqlite3';
import type { RateLookup } from '@budget-buddy/shared';
import { writeRevision } from './transactions.js';
import { linkAmountFor, linkChanges, readLink } from './wishLinks.js';

/**
 * Detaches the active links of a wish that was just deleted (Design 2): the
 * rows stay, marked `wish_deleted` at the time of the delete, and each
 * expense gets a revision "Link to <wish> removed" by `memberId`.
 */
export function detachWishLinks(
  database: Database.Database,
  wishId: number,
  memberId: number,
  now: number,
): void {
  const txnIds = database
    .prepare(
      `SELECT txn_id AS id FROM plan_link
       WHERE wish_id = ? AND detached_at IS NULL ORDER BY id`,
    )
    .all(wishId) as Array<{ id: bigint }>;
  for (const { id } of txnIds) {
    const txnId = Number(id);
    const link = readLink(database, txnId);
    if (!link) continue;
    database
      .prepare(
        `UPDATE plan_link SET detached_at = ?, detached_reason = 'wish_deleted'
         WHERE id = ?`,
      )
      .run(now, link.id);
    writeRevision(database, {
      txnId,
      action: 'update',
      changes: linkChanges(link, null, ''),
      changedBy: memberId,
      changedAt: now,
    });
  }
}

/**
 * Reattaches the links a delete of the wish detached at `deletedAt` that
 * still qualify (Design 2): the expense is a confirmed expense dated in the
 * link's month, with no envelope and no other link. Each reattached link is
 * logged as made by a member.
 * @returns The transaction ids that could not be reattached.
 */
export function reattachWishLinks(
  database: Database.Database,
  wishId: number,
  deletedAt: number,
  memberId: number,
  now: number,
  lookup: RateLookup,
): number[] {
  const rows = database
    .prepare(
      `SELECT l.id, l.txn_id AS txnId, l.month, l.amount,
         l.amount_manual AS manual, t.kind, t.status, t.date, t.amount AS txnAmount,
         p.envelope_id AS envelopeId, w.name, w.currency,
         a.currency AS txnCurrency,
         EXISTS (SELECT 1 FROM plan_link o WHERE o.txn_id = l.txn_id
           AND o.detached_at IS NULL) AS linked
       FROM plan_link l
         JOIN wish w ON w.id = l.wish_id
         JOIN txn t ON t.id = l.txn_id
         JOIN account a ON a.id = t.account_id
         LEFT JOIN txn_part p ON p.txn_id = t.id AND p.position = 1
       WHERE l.wish_id = ? AND l.detached_at = ?
         AND l.detached_reason = 'wish_deleted' ORDER BY l.id`,
    )
    .all(wishId, deletedAt) as Array<{
    id: bigint;
    txnId: bigint;
    month: string;
    amount: bigint | null;
    manual: bigint;
    kind: string;
    status: string;
    date: string;
    txnAmount: bigint;
    envelopeId: bigint | null;
    name: string;
    currency: string;
    txnCurrency: string;
    linked: bigint;
  }>;
  const notRestored: number[] = [];
  for (const row of rows) {
    const txnId = Number(row.txnId);
    const qualifies =
      row.kind === 'expense' &&
      row.status === 'confirmed' &&
      row.date.slice(0, 7) === row.month &&
      row.envelopeId === null &&
      row.linked === 0n;
    if (!qualifies) {
      notRestored.push(txnId);
      continue;
    }
    // The expense may have changed while detached: convert it anew.
    const amount = linkAmountFor(database, lookup, {
      amount: row.txnAmount,
      currency: row.txnCurrency,
      wishCurrency: row.currency,
      date: row.date,
    });
    database
      .prepare(
        `UPDATE plan_link SET detached_at = NULL, detached_reason = NULL,
           amount = ?, amount_manual = 0 WHERE id = ?`,
      )
      .run(amount, row.id);
    const link = readLink(database, txnId);
    if (!link) continue;
    // A reattach is logged as a link by a member, not "recorded".
    writeRevision(database, {
      txnId,
      action: 'update',
      changes: linkChanges(null, { ...link, madeHow: 'member' }, ''),
      changedBy: memberId,
      changedAt: now,
    });
  }
  return notRestored;
}

/**
 * Recomputes every active link of a wish after its currency changed (O5):
 * each amount is converted again from its expense at the rate of its date,
 * the typed-by-hand flag is cleared, and a changed amount is logged on the
 * expense as a corrected one. Call after the wish row holds the new currency.
 */
export function recomputeWishLinks(
  database: Database.Database,
  wishId: number,
  oldCurrency: string,
  lookup: RateLookup,
  memberId: number,
  now: number,
): void {
  const rows = database
    .prepare(
      `SELECT l.id, l.txn_id AS txnId, t.amount, t.date,
         a.currency AS currency
       FROM plan_link l
         JOIN txn t ON t.id = l.txn_id
         JOIN account a ON a.id = t.account_id
       WHERE l.wish_id = ? AND l.detached_at IS NULL ORDER BY l.id`,
    )
    .all(wishId) as Array<{
    id: bigint;
    txnId: bigint;
    amount: bigint;
    date: string;
    currency: string;
  }>;
  for (const row of rows) {
    const txnId = Number(row.txnId);
    const before = readLink(database, txnId);
    if (!before) continue;
    const amount = linkAmountFor(database, lookup, {
      amount: row.amount,
      currency: row.currency,
      wishCurrency: before.wishCurrency,
      date: row.date,
    });
    database
      .prepare(
        'UPDATE plan_link SET amount = ?, amount_manual = 0 WHERE id = ?',
      )
      .run(amount, row.id);
    const after = { ...before, amount, amountManual: false };
    const changes = linkChanges(
      { ...before, wishCurrency: oldCurrency },
      after,
      row.currency,
    );
    if (Object.keys(changes).length === 0) continue;
    writeRevision(database, {
      txnId,
      action: 'update',
      changes,
      changedBy: memberId,
      changedAt: now,
    });
  }
}
