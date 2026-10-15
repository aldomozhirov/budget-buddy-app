import {
  addMonths,
  formatMoney,
  getCurrency,
  todayInTimeZone,
  type CoinSetting,
  type Currency,
  type Envelope,
} from '@budget-buddy/shared';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `2026-10` as "October". */
export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

/** `2026-05` as "May 2026". */
export function monthWithYear(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

/** An instant as "30 Aug 2026" in the family time zone. */
export function shortDate(instant: number, timeZone: string): string {
  const [year, month, day] = todayInTimeZone(new Date(instant), timeZone)
    .split('-')
    .map(Number);
  return `${day} ${monthName(`${year}-${String(month).padStart(2, '0')}`).slice(0, 3)} ${year}`;
}

/** The header line of Envelopes: "October · next top-up on 1 November". */
export function topUpLine(month: string): string {
  return `${monthName(month)} · next top-up on 1 ${monthName(addMonths(month, 1))}`;
}

/** The mode tag of an envelope card. */
export function modeLabel(mode: 'carry_over' | 'reset'): string {
  return mode === 'reset' ? 'Resets monthly' : 'Carries over';
}

/** "1 expense" or "6 expenses". */
export function expenseCountText(count: number): string {
  return `${count} ${count === 1 ? 'expense' : 'expenses'}`;
}

/** What an envelope's card needs, formatted for display. */
export interface EnvelopeCardFigures {
  /** The balance: this month's closing. */
  left: bigint;
  spent: bigint;
  /** Opening, top-up and adjustments of the month. */
  available: bigint;
  /** The line under the bar: "… spent of … · 6 expenses" or UI-ENV-7. */
  detail: string;
}

/**
 * Works out an envelope card's amounts and its detail line: the starting
 * month says "starting balance", a carry-over envelope that carried something
 * says how much came with it, the rest count their expenses.
 */
export function cardFigures(
  envelope: Envelope,
  currency: Currency,
  month: string,
): EnvelopeCardFigures {
  const current = envelope.current;
  const left = BigInt(current?.closing ?? '0');
  const spent = BigInt(current?.spent ?? '0');
  const available = BigInt(current?.available ?? '0');
  const base = `${formatMoney(spent, currency)} spent of ${formatMoney(available, currency)}`;
  const opening = BigInt(current?.opening ?? '0');
  let tail = expenseCountText(envelope.monthExpenseCount);
  if (envelope.startingMonth === month) {
    tail = 'starting balance';
  } else if (current?.topUpMode === 'carry_over' && opening !== 0n) {
    tail = `${formatMoney(BigInt(current.topUp), currency)} + ${formatMoney(opening, currency)} carried from ${monthName(addMonths(month, -1))}`;
  }
  return { left, spent, available, detail: `${base} · ${tail}` };
}

/** The currency an envelope is kept in, or EUR when it is unknown. */
export function envelopeCurrency(
  code: string,
  coins: readonly CoinSetting[],
): Currency {
  return getCurrency(code, coins) ?? getCurrency('EUR')!;
}
