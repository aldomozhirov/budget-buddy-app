import {
  formatChange,
  formatDate,
  formatMoney,
  getCurrency,
  parseMinor,
  type CoinCurrency,
  type CheckinSummary,
  type WealthSeries,
} from '@budget-buddy/shared';

type Direction = 'up' | 'down' | 'unchanged';

/** Formats the minor-unit strings of the summary API for display. */
export interface MoneyFormatter {
  /** `€1,234.56`; a currency the app does not know shows `— XYZ`. */
  money(minor: string, code: string): string;
  /** `▲ €1,742.00`, `▼ ₽4,700.00` or `Unchanged`. */
  change(minor: string, code: string): string;
  /** `+€1,838.40`, `−€96.40` or `€0.00`, for the lines that add up. */
  signed(minor: string, code: string): string;
  /** `€ • • • • •`: the currency's symbol and dots, never digits. */
  masked(code: string): string;
}

/**
 * A currency the app does not know has no decimals to place the point by, so
 * raw minor units would read 100 times too large: show a dash instead.
 */
function unknownAmount(code: string): string {
  return `— ${code}`;
}

/** Builds a formatter that knows the family's coins. */
export function createMoneyFormatter(
  coins: readonly CoinCurrency[],
): MoneyFormatter {
  return {
    money(minor, code) {
      const currency = getCurrency(code, coins);
      return currency
        ? formatMoney(parseMinor(minor), currency)
        : unknownAmount(code);
    },
    change(minor, code) {
      const currency = getCurrency(code, coins);
      return currency
        ? formatChange(parseMinor(minor), currency)
        : unknownAmount(code);
    },
    signed(minor, code) {
      const currency = getCurrency(code, coins);
      if (!currency) return unknownAmount(code);
      const amount = parseMinor(minor);
      return `${amount > 0n ? '+' : ''}${formatMoney(amount, currency)}`;
    },
    masked(code) {
      return `${getCurrency(code, coins)?.symbol ?? code} • • • • •`;
    },
  };
}

/** The CSS colour class of a direction: accent up, warn down, else muted. */
export function directionClass(direction: Direction | null): string {
  if (direction === 'up') return 'pos';
  if (direction === 'down') return 'warn';
  return 'muted';
}

/** The direction of a signed minor-unit string. */
export function directionOfMinor(minor: string): Direction {
  const amount = parseMinor(minor);
  return amount > 0n ? 'up' : amount < 0n ? 'down' : 'unchanged';
}

/**
 * How one closed check-in compares with the one before it, from the chart
 * series: null when that needs a rate that is missing, `first` for the
 * oldest check-in.
 */
export type CheckinTrend = Direction | 'first' | null;

/** Maps each check-in of a dated series to its total and trend (UI-SUM-1). */
export function trendsFromSeries(
  series: WealthSeries,
): Map<number, { total: string | null; trend: CheckinTrend }> {
  const result = new Map<
    number,
    { total: string | null; trend: CheckinTrend }
  >();
  let previous: string | null | undefined;
  for (const point of series.points) {
    let trend: CheckinTrend = null;
    if (previous === undefined) trend = 'first';
    else if (previous !== null && point.amount !== null) {
      trend = directionOfMinor(
        (parseMinor(point.amount) - parseMinor(previous)).toString(),
      );
    }
    result.set(point.checkinId, { total: point.amount, trend });
    previous = point.amount;
  }
  return result;
}

/**
 * The words under a check-in total: `▲ up`, `▼ down`, `Unchanged`, `Start`.
 * Empty when no comparison is possible, because a rate is missing.
 */
export function trendText(trend: CheckinTrend): string {
  if (trend === 'up') return '▲ up';
  if (trend === 'down') return '▼ down';
  if (trend === 'unchanged') return 'Unchanged';
  if (trend === 'first') return 'Start';
  return '';
}

/** The points of the chart, leaving out those that lack a rate. */
export function chartPoints(
  series: WealthSeries,
  formatter: MoneyFormatter,
  timeZone: string,
): { date: string; tick: string; value: bigint; label: string }[] {
  return series.points.flatMap((point) => {
    if (point.amount === null) return [];
    return [
      {
        date: formatDate(point.date, timeZone),
        tick: new Intl.DateTimeFormat('en', {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        }).format(new Date(`${point.date}T12:00:00Z`)),
        value: parseMinor(point.amount),
        label: formatter.money(point.amount, series.currency),
      },
    ];
  });
}

/**
 * Text for a missing rate, naming the currency and the date it needs. It adds
 * "The total is incomplete." only when `totalComplete` is false: a currency
 * can lack a rate while the family total, which holds none of it, is whole.
 */
export function missingRatesText(
  missing: CheckinSummary['missingRates'],
  timeZone: string,
  totalComplete: boolean,
): string {
  const parts = missing.map(
    (rate) => `${rate.currency} on ${formatDate(rate.date, timeZone)}`,
  );
  const text = `Rate missing for ${parts.join(', ')}.`;
  return totalComplete ? text : `${text} The total is incomplete.`;
}

/**
 * The screen-reader summary of the wealth chart: `All in EUR over 1 check-in,
 * from 02/09/2026 to 02/09/2026`; `check-in` is singular for one point.
 */
export function wealthChartSummary(
  name: string,
  dates: readonly string[],
): string {
  const count = dates.length;
  const noun = count === 1 ? 'check-in' : 'check-ins';
  return `${name} over ${count} ${noun}, from ${dates[0] ?? 'the first date'} to ${dates.at(-1) ?? 'the latest date'}`;
}

/** Names accounts as `Sofia’s Cash €`, or just the name when it is shared. */
export function accountLabel(account: {
  name: string;
  ownerName: string | null;
}): string {
  return account.ownerName
    ? `${account.ownerName}’s ${account.name}`
    : account.name;
}

/** The label of an account type, as on the Accounts screen. */
export const accountTypeLabels = {
  bank: 'Bank',
  cash: 'Cash',
  investment: 'Investment',
  crypto: 'Crypto',
  we_owe: 'Money we owe',
  owed_to_us: 'Money owed to us',
} as const;
