import Decimal from 'decimal.js';

export function roundHalfAwayFromZero(value: Decimal.Value, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 100) throw new RangeError('Invalid decimal places');
  const rounded = new Decimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  return BigInt(rounded.toFixed(decimals).replace('.', ''));
}
