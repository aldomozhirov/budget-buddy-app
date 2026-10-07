import type { Currency } from './currency.js';

const powersOfTen = (decimals: number): bigint => 10n ** BigInt(decimals);

function numericParts(amount: bigint, decimals: number): { integer: string; fraction: string } {
  const factor = powersOfTen(decimals);
  return {
    integer: (amount / factor).toString(),
    fraction: decimals === 0 ? '' : (amount % factor).toString().padStart(decimals, '0'),
  };
}

function groupedInteger(integer: string): string {
  return new Intl.NumberFormat('en', { useGrouping: true, maximumFractionDigits: 0 }).format(BigInt(integer));
}

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

export function formatChange(change: bigint, currency: Currency): string {
  if (change === 0n) return 'Unchanged';
  const magnitude = change < 0n ? -change : change;
  return `${change > 0n ? '▲' : '▼'} ${formatMoney(magnitude, currency)}`;
}
