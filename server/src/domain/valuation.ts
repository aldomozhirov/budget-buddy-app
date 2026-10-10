import type Database from 'better-sqlite3';
import {
  convert,
  getCurrency,
  todayInTimeZone,
  type Currency,
} from '@budget-buddy/shared';
import { createRateLookup } from '../rates/lookup.js';

/** Converts amounts into the common currency at stored rates. */
export interface Valuation {
  commonCurrency: Currency;
  timeZone: string;
  /** The currency or coin behind a code stored on an account. */
  currency(code: string): Currency;
  /** The calendar day of an instant in the family's time zone. */
  dateOf(instant: number): string;
  /**
   * Converts `amount` of `code` into the common currency at the rates of
   * `date` or the nearest earlier day, rounding once. Returns `undefined`
   * when no rate exists, so a caller marks the figure incomplete. Zero needs
   * no rate and is always `0n`.
   */
  toCommon(amount: bigint, code: string, date: string): bigint | undefined;
}

type FamilyRow = { common_currency: string; time_zone: string };
type CoinRow = { code: string; name: string; decimals: bigint };

/**
 * Creates a valuation from the family's settings and the coins it holds,
 * reading rates through one remembering lookup.
 * @throws {Error} if the family is not set up or its common currency is
 * unknown.
 */
export function createValuation(database: Database.Database): Valuation {
  const family = database
    .prepare('SELECT common_currency, time_zone FROM family WHERE id = 1')
    .get() as FamilyRow | undefined;
  if (!family) throw new Error('First start has not been completed.');
  const coins = (
    database.prepare('SELECT code, name, decimals FROM coin').all() as CoinRow[]
  ).map((coin) => ({ ...coin, decimals: Number(coin.decimals) }));
  const lookup = createRateLookup(database);
  const known = new Map<string, Currency>();

  function currency(code: string): Currency {
    let resolved = known.get(code);
    if (!resolved) {
      resolved = getCurrency(code, coins);
      if (!resolved) throw new Error(`Unknown currency: ${code}`);
      known.set(code, resolved);
    }
    return resolved;
  }

  const commonCurrency = currency(family.common_currency);
  return {
    commonCurrency,
    timeZone: family.time_zone,
    currency,
    dateOf: (instant) => todayInTimeZone(new Date(instant), family.time_zone),
    toCommon(amount, code, date) {
      if (amount === 0n) return 0n;
      const result = convert(
        amount,
        currency(code),
        commonCurrency,
        date,
        lookup,
      );
      return 'missing' in result ? undefined : result.value;
    },
  };
}
