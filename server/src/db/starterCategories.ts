import type Database from 'better-sqlite3';

/**
 * The starter categories of requirements section 11 (CAT-3), in display
 * order: 14 expense, then 2 income. Migration 0005 inserts the same list for
 * an existing family; a test keeps the two equal.
 */
export const starterCategories = [
  { name: 'Groceries', kind: 'expense' },
  { name: 'Eating out', kind: 'expense' },
  { name: 'Housing', kind: 'expense' },
  { name: 'Utilities', kind: 'expense' },
  { name: 'Transport', kind: 'expense' },
  { name: 'Health', kind: 'expense' },
  { name: 'Insurance', kind: 'expense' },
  { name: 'Subscriptions', kind: 'expense' },
  { name: 'Shopping', kind: 'expense' },
  { name: 'Travel', kind: 'expense' },
  { name: 'Leisure', kind: 'expense' },
  { name: 'Gifts', kind: 'expense' },
  { name: 'Fees and taxes', kind: 'expense' },
  { name: 'Other', kind: 'expense' },
  { name: 'Salary', kind: 'income' },
  { name: 'Other income', kind: 'income' },
] as const;

/**
 * Adds the starter list at first start. A name that is already there is left
 * alone, so running it twice adds nothing.
 * @param now UTC epoch milliseconds for the created and updated times.
 */
export function insertStarterCategories(
  database: Database.Database,
  now: number,
): void {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO category
       (name, kind, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  starterCategories.forEach(({ name, kind }, index) => {
    insert.run(name, kind, index + 1, now, now);
  });
}
