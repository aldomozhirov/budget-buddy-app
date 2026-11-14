import {
  addMonths,
  type Wish,
  type WishExpense,
  type WishesResponse,
} from '@budget-buddy/shared';
import { expenseCountText } from '../envelopes/envelopeFormat.js';

/** Months between `from` and `to`, both `YYYY-MM`. */
function monthsBetween(from: string, to: string): number {
  const index = (month: string) =>
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  return index(to) - index(from);
}

/**
 * What the switcher says under the month (UI-WSH-1): "This month",
 * "Last month", "Next month · plan ahead", or how far away another one is.
 */
export function monthRelation(month: string, current: string): string {
  const gap = monthsBetween(current, month);
  if (gap === 0) return 'This month';
  if (gap === -1) return 'Last month';
  if (gap === 1) return 'Next month · plan ahead';
  return gap < 0 ? `${-gap} months ago` : `In ${gap} months · plan ahead`;
}

/** The earliest month the server serves (`GET /api/wishes`). */
export const EARLIEST_MONTH = '2000-01';

/** Whether the switcher's previous arrow has a month to go to. */
export function hasPreviousMonth(month: string): boolean {
  return month > EARLIEST_MONTH;
}

/** Coming months stop at the one after the current month (UI-WSH-1). */
export function hasNextMonth(month: string, current: string): boolean {
  return month < addMonths(current, 1);
}

/** "3 wishes · 2 open" (UI-WSH-2). */
export function summaryLine(counts: WishesResponse['counts']): string {
  const wishes = `${counts.total} ${counts.total === 1 ? 'wish' : 'wishes'}`;
  return `${wishes} · ${counts.open} open`;
}

/** The amounts of an open wish's card, as minor-unit strings. */
export interface WishCardFigures {
  /** The large figure: what is left, or how far over. */
  headline: bigint;
  /** The word after it. */
  unit: 'left' | 'to spend' | 'over';
  /** Share of the bar, as numbers for the progress component. */
  spent: number;
  total: number;
}

/**
 * The large figure of an open wish's card: "€230.00 left", "€480.00 to
 * spend" while nothing is spent, "€12.00 over" past the amount.
 */
export function cardFigures(wish: Wish): WishCardFigures {
  const spent = BigInt(wish.spent);
  const left = BigInt(wish.left);
  const base = { spent: Number(spent), total: Number(wish.amount) };
  if (left < 0n) return { ...base, headline: BigInt(wish.over), unit: 'over' };
  return {
    ...base,
    headline: left,
    unit: spent === 0n && wish.expenseCount === 0 ? 'to spend' : 'left',
  };
}

/**
 * The line under the bar: "€120.00 spent of €350.00 · 1 expense" or
 * "Nothing spent yet · €480.00", with "Rate missing" when an expense has no
 * amount yet.
 */
export function cardDetail(
  wish: Wish,
  money: (minor: string) => string,
): string {
  const parts =
    BigInt(wish.spent) === 0n && wish.expenseCount === 0
      ? [`Nothing spent yet · ${money(wish.amount)}`]
      : [
          `${money(wish.spent)} spent of ${money(wish.amount)}`,
          expenseCountText(wish.expenseCount),
        ];
  if (wish.incomplete) parts.push('Rate missing');
  return parts.join(' · ');
}

/**
 * The second line of a done or dropped wish's row: "€137.80 of €150.00 ·
 * €12.20 under", "€200.00 · nothing spent".
 */
export function doneDetail(
  wish: Wish,
  money: (minor: string) => string,
): string {
  const spent = BigInt(wish.spent);
  if (spent === 0n && !wish.incomplete) {
    return `${money(wish.amount)} · nothing spent`;
  }
  const parts = [`${money(wish.spent)} of ${money(wish.amount)}`];
  if (BigInt(wish.under) > 0n) parts.push(`${money(wish.under)} under`);
  else if (BigInt(wish.over) > 0n) parts.push(`${money(wish.over)} over`);
  if (wish.incomplete) parts.push('Rate missing');
  return parts.join(' · ');
}

/**
 * The line under a wish page's bar: "€120.00 spent of €350.00 · 1 expense",
 * for a closed wish with "· €12.20 under" or "· €5.00 over" (UI-WSH-4).
 */
export function pageDetail(
  wish: Wish,
  money: (minor: string) => string,
): string {
  if (wish.state === 'open') return cardDetail(wish, money);
  const parts = [
    `${money(wish.spent)} spent of ${money(wish.amount)}`,
    expenseCountText(wish.expenseCount),
  ];
  if (BigInt(wish.under) > 0n) parts.push(`${money(wish.under)} under`);
  else if (BigInt(wish.over) > 0n) parts.push(`${money(wish.over)} over`);
  if (wish.incomplete) parts.push('Rate missing');
  return parts.join(' · ');
}

/** "recorded from the wish" or "linked by Alena" (UI-WSH-4). */
export function madeLine(expense: WishExpense): string {
  if (expense.madeHow === 'recorded') return 'recorded from the wish';
  return expense.madeBy ? `linked by ${expense.madeBy}` : 'linked';
}

/** `2026-10-01` as "01/10", the design's short date. */
export function shortDay(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
