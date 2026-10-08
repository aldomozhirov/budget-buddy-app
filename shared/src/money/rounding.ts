import Decimal from 'decimal.js';

/**
 * Rounds a decimal to `decimals` places, half away from zero, and returns it
 * as an integer scaled by 10^decimals (so `'-0.005'` at 2 places gives `-1n`).
 * This is the one rounding rule for all money.
 * @throws {RangeError} if `decimals` is not an integer from 0 to 100.
 * @throws {Error} if `value` is not a finite decimal.
 */
export function roundHalfAwayFromZero(value: Decimal.Value, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 100) throw new RangeError('Invalid decimal places');
  const rounded = new Decimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  return BigInt(rounded.toFixed(decimals).replace('.', ''));
}
