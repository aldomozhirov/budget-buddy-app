import type Database from 'better-sqlite3';
import type { Rule } from '@budget-buddy/shared';

/**
 * Gives the rules the positions 1..n in the order of `ids`, which must name
 * every rule once. The order is computed before anything is written, and the
 * rows are first parked on negative positions because SQLite checks
 * `UNIQUE (position)` row by row.
 */
export function writeRuleOrder(
  database: Database.Database,
  ids: readonly number[],
): void {
  const update = database.prepare('UPDATE rule SET position = ? WHERE id = ?');
  for (const id of ids) update.run(-id, id);
  ids.forEach((id, index) => update.run(index + 1, id));
}

/** Renumbers the rules 1..n in their current order, closing any gap. */
export function closeRuleGaps(database: Database.Database): void {
  const rows = database
    .prepare('SELECT id FROM rule ORDER BY position')
    .all() as { id: bigint }[];
  writeRuleOrder(
    database,
    rows.map((row) => Number(row.id)),
  );
}

interface RuleRow {
  id: bigint;
  position: bigint;
  pattern: string;
  categoryId: bigint;
  envelopeId: bigint | null;
  accountId: bigint | null;
  categoryArchived: bigint;
  envelopeArchived: bigint;
  createdBy: bigint;
  createdAt: bigint;
  updatedBy: bigint;
  updatedAt: bigint;
}

/** Rules in the order they are tried; one when `id` is given. */
export function loadRules(database: Database.Database, id?: number): Rule[] {
  const rows = database
    .prepare(
      `SELECT r.id, r.position, r.pattern, r.category_id AS categoryId,
              r.envelope_id AS envelopeId, r.account_id AS accountId,
              c.archived_at IS NOT NULL AS categoryArchived,
              e.archived_at IS NOT NULL AS envelopeArchived,
              r.created_by AS createdBy, r.created_at AS createdAt,
              r.updated_by AS updatedBy, r.updated_at AS updatedAt
         FROM rule r
         JOIN category c ON c.id = r.category_id
         LEFT JOIN envelope e ON e.id = r.envelope_id
        WHERE (? IS NULL OR r.id = ?)
        ORDER BY r.position`,
    )
    .all(id ?? null, id ?? null) as RuleRow[];
  return rows.map((row) => ({
    id: Number(row.id),
    position: Number(row.position),
    pattern: row.pattern,
    categoryId: Number(row.categoryId),
    envelopeId: row.envelopeId === null ? null : Number(row.envelopeId),
    accountId: row.accountId === null ? null : Number(row.accountId),
    categoryArchived: row.categoryArchived !== 0n,
    envelopeArchived: row.envelopeArchived !== 0n,
    createdBy: Number(row.createdBy),
    createdAt: Number(row.createdAt),
    updatedBy: Number(row.updatedBy),
    updatedAt: Number(row.updatedAt),
  }));
}
