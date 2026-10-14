import type Database from 'better-sqlite3';

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
