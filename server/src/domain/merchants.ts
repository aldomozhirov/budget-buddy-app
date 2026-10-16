import type Database from 'better-sqlite3';
import {
  matchRule,
  merchantKey,
  type MerchantSuggestion,
} from '@budget-buddy/shared';
import { loadRules } from './rules.js';

/** What `GET /api/merchants` answers at most. */
export const MERCHANT_SEARCH_LIMIT = 20;

/** What the add options keep for the phone at most (D3). */
export const KNOWN_MERCHANT_LIMIT = 500;

/**
 * The merchants of confirmed expenses, newest use first. Each merchant is
 * counted once under its key, with its most recent spelling (UI-ADD-3).
 * @param search Part of a merchant, in any case; blank for all.
 */
export function knownMerchants(
  database: Database.Database,
  options: { search?: string; limit: number },
): { merchant: string; key: string; lastUsedOn: string }[] {
  const search = merchantKey(options.search ?? '');
  const rows = database
    .prepare(
      `SELECT merchant, merchant_key AS key, date FROM (
         SELECT merchant, merchant_key, date, id,
                ROW_NUMBER() OVER (
                  PARTITION BY merchant_key ORDER BY date DESC, id DESC
                ) AS rank
           FROM txn
          WHERE kind = 'expense' AND status = 'confirmed'
            AND merchant IS NOT NULL AND merchant_key IS NOT NULL
            AND merchant_key != ''
            AND (? = '' OR instr(merchant_key, ?) > 0)
       ) WHERE rank = 1
       ORDER BY date DESC, id DESC LIMIT ?`,
    )
    .all(search, search, options.limit) as {
    merchant: string;
    key: string;
    date: string;
  }[];
  return rows.map((row) => ({
    merchant: row.merchant,
    key: row.key,
    lastUsedOn: row.date,
  }));
}

/**
 * Known merchants matching a search, each with the rule that would label it
 * (O9). A rule limited to an account matches only when `accountId` is it.
 */
export function searchMerchants(
  database: Database.Database,
  query: { q?: string | undefined; accountId?: number | undefined },
): MerchantSuggestion[] {
  const rules = loadRules(database);
  return knownMerchants(database, {
    ...(query.q === undefined ? {} : { search: query.q }),
    limit: MERCHANT_SEARCH_LIMIT,
  }).map((entry) => {
    const match = matchRule(entry.merchant, query.accountId ?? null, rules);
    return {
      ...entry,
      rule: match
        ? {
            id: match.rule.id,
            categoryId: match.categoryId,
            envelopeId: match.envelopeId,
          }
        : null,
    };
  });
}
