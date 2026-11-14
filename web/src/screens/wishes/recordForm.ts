import {
  convert,
  getCurrency,
  type CoinCurrency,
  type Currency,
  type DatedRate,
  type Wish,
} from '@budget-buddy/shared';
import { dayLabel, pairLookup } from '../add/addForm.js';
import { rateText } from '../transactions/transactionPage.js';

/** The amount the record sheet starts with, in the wish's currency. */
export interface SheetBase {
  /** In minor units of the wish's currency. */
  amount: bigint;
  /** The words beside the amount (UI-WSH-5). */
  label: string;
}

/**
 * What the sheet starts with: what is left of a partly spent wish, else the
 * wish's amount. A wish that is spent in full or over starts from its amount.
 */
export function sheetBase(wish: Wish): SheetBase {
  const left = BigInt(wish.left);
  if (wish.expenseCount > 0 && left > 0n) {
    return { amount: left, label: 'What’s left of the wish' };
  }
  return { amount: BigInt(wish.amount), label: 'The wish’s amount' };
}

/**
 * The base amount in the paying account's currency at the day's rate: the
 * same amount in the wish's currency, the converted one, or null while the
 * rate is missing.
 */
export function convertedBase(
  base: bigint,
  from: Currency,
  to: Currency,
  date: string,
  rate: DatedRate | null,
): bigint | null {
  if (from.code === to.code) return base;
  if (!rate) return null;
  const result = convert(
    base,
    from,
    to,
    date,
    pairLookup(from.code, to.code, rate),
  );
  return 'value' in result ? result.value : null;
}

/** "€1 = $1.093 today": the day's rate between two currencies. */
export function recordRateLine(
  rate: DatedRate,
  from: string,
  to: string,
  date: string,
  today: string,
  coins: readonly CoinCurrency[],
): string {
  const symbol = (code: string) =>
    getCurrency(code, coins)?.symbol ?? `${code} `;
  const when = date === today ? 'today' : `on ${dayLabel(date, today)}`;
  return `${symbol(from)}1 = ${symbol(to)}${rateText(rate.rate)} ${when}`;
}
