import {
  formatMoney,
  getCurrency,
  type CoinCurrency,
  type ListedTransaction,
  type TransactionFacet,
  type TransactionFilterKind,
  type TransactionPeriod,
  type TransactionTotals,
} from '@budget-buddy/shared';
import { monthName } from '../envelopes/envelopeFormat.js';

/** The periods the screen offers; a custom range has no design yet. */
export type PeriodChoice = Exclude<TransactionPeriod, 'custom'>;

/** The period a fresh list opens on (UI-TXN-1). */
export const DEFAULT_PERIOD: PeriodChoice = 'this_month';

/** The periods in the order the sheet lists them. */
export const PERIODS: readonly PeriodChoice[] = [
  'this_month',
  'last_month',
  'last_3_months',
  'this_year',
  'all',
];

/** A category or envelope filter value: an id, or `none` for "without". */
export type IdOrNone = number | 'none';

/** What the list is filtered by; an empty list means "show all". */
export interface TransactionFilters {
  period: PeriodChoice;
  member: number[];
  account: number[];
  category: IdOrNone[];
  envelope: IdOrNone[];
  kind: TransactionFilterKind[];
  /** The search text, as typed. */
  q: string;
}

/** The names the chips, the sheets and the rows need, by id. */
export interface FilterNames {
  member: ReadonlyMap<number, string>;
  account: ReadonlyMap<number, string>;
  category: ReadonlyMap<number, string>;
  envelope: ReadonlyMap<number, string>;
}

/** Facets that pick several values; the period picks one. */
export type ListFacet = Exclude<TransactionFacet, 'period'>;

/** The kinds in the order the sheet lists them, with their names. */
export const KIND_LABELS: Readonly<Record<TransactionFilterKind, string>> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  refund: 'Refund',
};

/** The period options by name ("All time" is O14). */
export const PERIOD_LABELS: Readonly<Record<PeriodChoice, string>> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  all: 'All time',
};

/** Filters of a fresh list: this month, nothing else. */
export function emptyFilters(): TransactionFilters {
  return {
    period: DEFAULT_PERIOD,
    member: [],
    account: [],
    category: [],
    envelope: [],
    kind: [],
    q: '',
  };
}

type QueryValue = string | null | readonly (string | null)[] | undefined;

function parts(value: QueryValue): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
    .filter((item) => item !== '');
}

function ids(value: QueryValue): number[] {
  return parts(value)
    .filter((item) => /^[1-9]\d{0,14}$/u.test(item))
    .map(Number);
}

function idsOrNone(value: QueryValue): IdOrNone[] {
  return parts(value)
    .filter((item) => item === 'none' || /^[1-9]\d{0,14}$/u.test(item))
    .map((item) => (item === 'none' ? 'none' : Number(item)));
}

/** Reads the filters a link carries (`?account=3&period=all`). */
export function filtersFromQuery(
  query: Record<string, QueryValue>,
): TransactionFilters {
  const period = parts(query.period)[0];
  const kinds = parts(query.kind).filter(
    (item): item is TransactionFilterKind => item in KIND_LABELS,
  );
  return {
    period: PERIODS.find((item) => item === period) ?? DEFAULT_PERIOD,
    member: ids(query.member),
    account: ids(query.account),
    category: idsOrNone(query.category),
    envelope: idsOrNone(query.envelope),
    kind: kinds,
    q: parts(query.q).join(','),
  };
}

/**
 * The query string of `GET /api/transactions` and `/facets` for these
 * filters. A blank search is left out, as the server trims it anyway.
 */
export function filtersToParams(filters: TransactionFilters): URLSearchParams {
  const params = new URLSearchParams({ period: filters.period });
  const lists = {
    member: filters.member,
    account: filters.account,
    category: filters.category,
    envelope: filters.envelope,
    kind: filters.kind,
  };
  for (const [name, values] of Object.entries(lists)) {
    if (values.length > 0) params.set(name, values.join(','));
  }
  if (filters.q.trim() !== '') params.set('q', filters.q.trim());
  return params;
}

/** Whether any filter, the search included, differs from a fresh list. */
export function hasActiveFilters(filters: TransactionFilters): boolean {
  return (
    filters.period !== DEFAULT_PERIOD ||
    filters.q.trim() !== '' ||
    filters.member.length > 0 ||
    filters.account.length > 0 ||
    filters.category.length > 0 ||
    filters.envelope.length > 0 ||
    filters.kind.length > 0
  );
}

/** Whether the chip of this facet is filled: it narrows the list. */
export function isFacetActive(
  filters: TransactionFilters,
  facet: TransactionFacet,
): boolean {
  if (facet === 'period') return true;
  return filters[facet].length > 0;
}

/** The value of a facet option as the API names it (`none`, an id). */
export function optionValue(value: IdOrNone | TransactionFilterKind): string {
  return String(value);
}

/**
 * The words on a filter chip: its kind when nothing is picked ("Account"),
 * the name when one is, and a count for several ("2 accounts").
 * @param month The current month, `YYYY-MM`, named on the period chip.
 */
export function chipLabel(
  facet: TransactionFacet,
  filters: TransactionFilters,
  names: FilterNames,
  month: string,
): string {
  if (facet === 'period') {
    return filters.period === 'this_month' && month !== ''
      ? monthName(month)
      : PERIOD_LABELS[filters.period];
  }
  const picked = filters[facet];
  const nouns = {
    member: ['Everyone', 'people'],
    account: ['Account', 'accounts'],
    category: ['Category', 'categories'],
    envelope: ['Envelope', 'envelopes'],
    kind: ['Kind', 'kinds'],
  } as const;
  const [empty, plural] = nouns[facet];
  if (picked.length === 0) return empty;
  if (picked.length > 1) return `${picked.length} ${plural}`;
  const only = picked[0];
  if (only === 'none')
    return facet === 'envelope' ? 'No envelope' : 'No category';
  if (facet === 'kind') return KIND_LABELS[only as TransactionFilterKind];
  return names[facet].get(only as number) ?? empty;
}

/** An amount in minor units of a currency code, as `−€64.20`. */
export function money(
  minor: bigint | string,
  code: string,
  coins: readonly CoinCurrency[],
): string {
  const currency = getCurrency(code, coins);
  const amount = typeof minor === 'bigint' ? minor : BigInt(minor);
  return currency ? formatMoney(amount, currency) : `${amount} ${code}`;
}

/** How a row reads: its words, its signed amount and how to colour it. */
export interface RowText {
  title: string;
  meta: string;
  amount: string;
  /** `in` for income and refunds, `neutral` for a transfer. */
  tone: 'out' | 'in' | 'neutral';
  /** The "No category" tag shows (not for a transfer). */
  noCategory: boolean;
  /** A transfer into another currency: what arrives, "→ $21.86". */
  arrives: string;
}

/**
 * The words of a row (UI-TXN-2): the merchant, or the category when there is
 * none, over a meta line of the kind, category, envelope, account and member.
 * An expense shows with a minus; income and a refund (an expense below zero)
 * with a plus; a transfer plain, in the sending account's currency.
 */
export function describeRow(
  row: ListedTransaction,
  coins: readonly CoinCurrency[],
): RowText {
  const amount = BigInt(row.amount);
  const refund = row.kind === 'expense' && amount < 0n;
  const noCategory = row.kind !== 'transfer' && row.categoryName === null;
  const meta: string[] = [];
  let title: string;
  let text: string;
  let tone: RowText['tone'];
  let arrives = '';

  if (row.kind === 'transfer') {
    title = `${row.accountName} → ${row.toAccountName ?? ''}`;
    meta.push('Transfer');
    if (row.note !== null) meta.push(row.note);
    text = money(amount, row.currency, coins);
    tone = 'neutral';
    if (row.toCurrency !== null && row.toCurrency !== row.currency) {
      arrives = `→ ${money(row.toAmount ?? '0', row.toCurrency, coins)}`;
    }
  } else {
    const label = refund
      ? 'Refund'
      : row.kind === 'income'
        ? 'Income'
        : 'Expense';
    title = row.merchant ?? row.categoryName ?? label;
    if (refund) meta.push('Refund');
    meta.push(row.categoryName ?? 'No category');
    if (row.envelopeName !== null && row.envelopeName !== row.categoryName) {
      meta.push(row.envelopeName);
    }
    meta.push(row.accountName);
    if (row.kind === 'income' || refund) {
      text = `+${money(refund ? -amount : amount, row.currency, coins)}`;
      tone = 'in';
    } else {
      text = money(-amount, row.currency, coins);
      tone = 'out';
    }
  }
  meta.push(row.memberName);
  return {
    title,
    meta: meta.join(' · '),
    amount: text,
    tone,
    noCategory,
    arrives,
  };
}

/**
 * The heading of a day: "Today", or "Sun 4 Oct", with the year when it is
 * not this year's.
 * @param today `YYYY-MM-DD` in the family time zone.
 */
export function dayHeading(date: string, today: string): string {
  if (date === today) return 'Today';
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const weekday = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    'en-GB',
    { weekday: 'short', timeZone: 'UTC' },
  );
  const monthShort = monthName(
    `${year}-${String(month).padStart(2, '0')}`,
  ).slice(0, 3);
  const suffix = year === Number(today.slice(0, 4)) ? '' : ` ${year}`;
  return `${weekday} ${day} ${monthShort}${suffix}`;
}

/**
 * The totals of some transactions in the common currency (COR-4). The
 * summary line says both, "€189.05 spent · +€4,200.00 in"; a day header
 * says what was spent, or else what came in ("€92.35 spent"). "Rate missing"
 * is added when a rate was left out. Empty when there is nothing to say (a
 * day of transfers).
 */
export function totalsText(
  totals: TransactionTotals,
  currencyCode: string,
  coins: readonly CoinCurrency[],
  scope: 'day' | 'summary',
): string {
  const spent = BigInt(totals.spent);
  const income = BigInt(totals.income);
  const out: string[] = [];
  if (spent !== 0n || scope === 'summary') {
    out.push(`${money(spent, currencyCode, coins)} spent`);
  }
  if (income !== 0n && (scope === 'summary' || spent === 0n)) {
    out.push(`+${money(income, currencyCode, coins)} in`);
  }
  if (totals.incomplete) out.push('Rate missing');
  return out.join(' · ');
}

/** "1 transaction" or "5 transactions". */
export function countText(count: number): string {
  return `${count} ${count === 1 ? 'transaction' : 'transactions'}`;
}

/** What the screen knows about each option of the id-based filters. */
export interface FilterLookups {
  member: readonly { id: number; name: string; archived: boolean }[];
  account: readonly { id: number; name: string; archived: boolean }[];
  category: readonly {
    id: number;
    name: string;
    kind: 'expense' | 'income';
    archived: boolean;
  }[];
  envelope: readonly { id: number; name: string; archived: boolean }[];
}

/** One row of the filter sheet. */
export interface SheetOption {
  /** The value the API names: an id, `none`, a kind or a period. */
  value: string;
  label: string;
  /** A second line, such as "Waiting to be labelled". */
  sub?: string;
  /** The `.t-group` heading this option sits under, if the list groups. */
  group?: string;
  /** Transactions with only this option picked (the facet's count). */
  count: number;
  selected: boolean;
}

/**
 * The rows of one facet's sheet (UI-TXN-1): every option the family has, in
 * list order, with its count (0 when none). An archived account, category or
 * envelope, or an inactive profile, is listed only while it has transactions
 * or is picked. "No category" and "No envelope" come last; categories sit
 * under "Expense categories" and "Income categories" once both kinds are
 * listed.
 */
export function facetOptions(
  facet: TransactionFacet,
  lookups: FilterLookups,
  counts: ReadonlyMap<string, number>,
  filters: TransactionFilters,
): SheetOption[] {
  const picked = new Set<string>(
    facet === 'period' ? [filters.period] : filters[facet].map(optionValue),
  );
  const option = (
    value: string,
    label: string,
    extra: Partial<SheetOption> = {},
  ): SheetOption => ({
    value,
    label,
    count: counts.get(value) ?? 0,
    selected: picked.has(value),
    ...extra,
  });
  const visible = (value: string, archived: boolean): boolean =>
    !archived || (counts.get(value) ?? 0) > 0 || picked.has(value);

  if (facet === 'period') {
    return PERIODS.map((value) => option(value, PERIOD_LABELS[value]));
  }
  if (facet === 'kind') {
    return (Object.keys(KIND_LABELS) as TransactionFilterKind[]).map((value) =>
      option(value, KIND_LABELS[value]),
    );
  }
  if (facet === 'member') {
    return lookups.member
      .filter((item) => visible(String(item.id), item.archived))
      .map((item) => option(String(item.id), item.name));
  }
  if (facet === 'account') {
    return lookups.account
      .filter((item) => visible(String(item.id), item.archived))
      .map((item) => option(String(item.id), item.name));
  }
  if (facet === 'envelope') {
    return [
      ...lookups.envelope
        .filter((item) => visible(String(item.id), item.archived))
        .map((item) => option(String(item.id), item.name)),
      option('none', 'No envelope', { sub: 'Expenses without one' }),
    ];
  }
  const categories = lookups.category.filter((item) =>
    visible(String(item.id), item.archived),
  );
  const both =
    categories.some((item) => item.kind === 'expense') &&
    categories.some((item) => item.kind === 'income');
  const rows = (['expense', 'income'] as const).flatMap((kind) =>
    categories
      .filter((item) => item.kind === kind)
      .map((item) =>
        option(String(item.id), item.name, {
          ...(both
            ? {
                group:
                  kind === 'expense'
                    ? 'Expense categories'
                    : 'Income categories',
              }
            : {}),
        }),
      ),
  );
  return [
    ...rows,
    option('none', 'No category', { sub: 'Waiting to be labelled' }),
  ];
}
