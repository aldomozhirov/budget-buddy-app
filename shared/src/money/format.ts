import type { Currency } from './currency.js';

const powersOfTen = (decimals: number): bigint => 10n ** BigInt(decimals);

/** Splits a non-negative minor amount into whole and fraction digit strings. */
function numericParts(amount: bigint, decimals: number): { integer: string; fraction: string } {
  const factor = powersOfTen(decimals);
  return {
    integer: (amount / factor).toString(),
    fraction: decimals === 0 ? '' : (amount % factor).toString().padStart(decimals, '0'),
  };
}

/** Adds comma thousands separators to a string of digits, exactly. */
function groupedInteger(integer: string): string {
  return new Intl.NumberFormat('en', { useGrouping: true, maximumFractionDigits: 0 }).format(BigInt(integer));
}

/**
 * Formats minor units for display with the currency's own decimals, comma
 * grouping and a U+2212 minus sign. Fiat amounts take symbol placement from
 * Intl's English pattern; coins are always prefixed with their symbol.
 * @example
 * formatMoney(-1450n, getCurrency('EUR')!); // '−€14.50'
 */
export function formatMoney(amount: bigint, currency: Currency): string {
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const { integer, fraction } = numericParts(magnitude, currency.decimals);
  const grouped = groupedInteger(integer);
  let numeric = grouped;
  if (currency.decimals > 0) numeric += `.${fraction}`;
  if (currency.kind === 'coin') return `${negative ? '−' : ''}${currency.symbol}${numeric}`;

  const pattern = new Intl.NumberFormat('en', {
    style: 'currency', currency: currency.code, currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals,
  }).formatToParts(negative ? -1n : 1n);
  const output = pattern.map((part) => {
    if (part.type === 'integer') return grouped;
    if (part.type === 'fraction') return fraction;
    if (part.type === 'decimal') return currency.decimals === 0 ? '' : '.';
    if (part.type === 'minusSign') return '−';
    return part.value;
  }).join('');
  return output;
}

/**
 * Formats a change in minor units as ▲ or ▼ with its magnitude, or
 * `'Unchanged'` when it is zero.
 * @example
 * formatChange(-470000n, getCurrency('RUB')!); // '▼ ₽4,700.00'
 */
export function formatChange(change: bigint, currency: Currency): string {
  if (change === 0n) return 'Unchanged';
  const magnitude = change < 0n ? -change : change;
  return `${change > 0n ? '▲' : '▼'} ${formatMoney(magnitude, currency)}`;
}
