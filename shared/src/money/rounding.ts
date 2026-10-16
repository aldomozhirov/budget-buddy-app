import Decimal from 'decimal.js';

/**
 * Rounds a decimal to `decimals` places, half away from zero, and returns it
 * as an integer scaled by 10^decimals (so `'-0.005'` at 2 places gives `-1n`).
 * This is the one rounding rule for all money.
 * @throws {RangeError} if `decimals` is not an integer from 0 to 100, or
 * `value` is not a finite decimal.
 */
export function roundHalfAwayFromZero(value: Decimal.Value, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 100) throw new RangeError('Invalid decimal places');
  let decimal: Decimal;
  try {
    decimal = new Decimal(value);
  } catch {
    throw new RangeError('Value must be a decimal number');
  }
  if (!decimal.isFinite()) throw new RangeError('Value must be finite');
  const rounded = decimal.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  return BigInt(rounded.toFixed(decimals).replace('.', ''));
}
