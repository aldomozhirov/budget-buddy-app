import type Database from 'better-sqlite3';
import {
  getCurrency,
  isMinorInRange,
  roundHalfAwayFromZero,
  type Currency,
} from '@budget-buddy/shared';

/**
 * Finds an ISO currency, or a coin the family added in Settings, by code.
 * Undefined for an unknown code.
 */
export function lookupCurrency(
  database: Database.Database,
  code: string,
): Currency | undefined {
  const iso = getCurrency(code);
  if (iso) return iso;
  const coin = database
    .prepare(
      'SELECT code, name, decimals FROM coin WHERE code = ? COLLATE NOCASE',
    )
    .get(code) as
    { code: string; name: string; decimals: bigint | number } | undefined;
  return coin
    ? getCurrency(code, [
        { code: coin.code, name: coin.name, decimals: Number(coin.decimals) },
      ])
    : undefined;
}

/**
 * Relabels an amount from one currency's decimals to another's without
 * converting it (ACC-5, ENV-7): fewer decimals round half away from zero.
 * @throws {RangeError} if the result is outside the 64-bit range.
 */
export function rescaleMinor(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  let result: bigint;
  if (toDecimals >= fromDecimals) {
    result = amount * 10n ** BigInt(toDecimals - fromDecimals);
  } else {
    const divisor = 10n ** BigInt(fromDecimals - toDecimals);
    const absolute = amount < 0n ? -amount : amount;
    const whole = absolute / divisor;
    const remainder = (absolute % divisor)
      .toString()
      .padStart(fromDecimals - toDecimals, '0');
    const value = `${amount < 0n ? '-' : ''}${whole}.${remainder}`;
    result = roundHalfAwayFromZero(value, 0);
  }
  if (!isMinorInRange(result)) throw new RangeError('Amount is too large');
  return result;
}
