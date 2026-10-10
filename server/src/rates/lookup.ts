import type Database from 'better-sqlite3';
import type { DatedRate, RateLookup } from '@budget-buddy/shared';

/**
 * Reads stored rates for `convert`: the latest rate of a pair dated on or
 * before a day (rule 4.2.4). It only reads, so a feed failing leaves it
 * working on what is stored. Answers are remembered for the life of the
 * lookup, so create one per computation and not per process.
 */
export function createRateLookup(database: Database.Database): RateLookup {
  const select = database.prepare(
    `SELECT rate, date FROM rate WHERE base = ? AND quote = ? AND date <= ?
     ORDER BY date DESC LIMIT 1`,
  );
  const answers = new Map<string, DatedRate | undefined>();
  return (base, quote, onOrBefore) => {
    const key = `${base}|${quote}|${onOrBefore}`;
    if (answers.has(key)) return answers.get(key);
    const row = select.get(base, quote, onOrBefore) as DatedRate | undefined;
    answers.set(key, row);
    return row;
  };
}
