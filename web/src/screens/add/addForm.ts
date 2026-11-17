import {
  convert,
  formatMoney,
  getCurrency,
  getIsoCurrency,
  type AddOptionsAccount,
  type CoinCurrency,
  type Currency,
  type DatedRate,
  type RateLookup,
  type RuleMatch,
  type TransactionKind,
  type Wish,
} from '@budget-buddy/shared';
import { rateText } from '../transactions/transactionPage.js';

/** What the Add form records; the control at the top switches it. */
export type FormKind = TransactionKind;

/** The words that change with the kind of the form (UI-ADD-2, UI-ADD-6). */
export interface KindWords {
  /** Title of the saved view: "Expense saved". */
  noun: string;
  /** Label above the first account row. */
  fromLabel: string;
  /** Title of the first account's search sheet. */
  fromSheet: string;
  /** Label of the person tile and title of its sheet. */
  payerLabel: string;
  /** The line in the person sheet. */
  payerHint: string;
}

const KIND_WORDS: Record<FormKind, KindWords> = {
  expense: {
    noun: 'Expense',
    fromLabel: 'Paid from',
    fromSheet: 'Paid from',
    payerLabel: 'Paid by',
    payerHint: 'Who paid. The account above stays as picked.',
  },
  income: {
    noun: 'Income',
    fromLabel: 'Paid into',
    fromSheet: 'Paid into',
    payerLabel: 'Received by',
    payerHint: 'Who received the money.',
  },
  transfer: {
    noun: 'Transfer',
    fromLabel: 'From',
    fromSheet: 'Transfer from',
    payerLabel: 'Done by',
    payerHint: 'Who moved the money. The accounts above stay as picked.',
  },
};

/** The words of one kind. */
export function kindWords(kind: FormKind): KindWords {
  return KIND_WORDS[kind];
}

/** The kind named by `/add?kind=`; anything else opens an expense. */
export function parseKind(value: unknown): FormKind {
  const first = Array.isArray(value) ? value[0] : value;
  return first === 'income' || first === 'transfer' ? first : 'expense';
}

/**
 * The envelope named by `/add?envelopeId=`: a positive whole number, the
 * first of a repeated query value; anything else is null.
 */
export function parseEnvelopeId(value: unknown): number | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'number') {
    return Number.isSafeInteger(first) && first > 0 ? first : null;
  }
  if (typeof first !== 'string' || !/^[1-9][0-9]*$/.test(first)) return null;
  const id = Number(first);
  return Number.isSafeInteger(id) ? id : null;
}

/** The wish named by `/add?wishId=`, read like `parseEnvelopeId`. */
export function parseWishId(value: unknown): number | null {
  return parseEnvelopeId(value);
}

/**
 * What a wish prefills the amount with, in the wish's currency: what is
 * left of it, or null when nothing is left (UI-ADD, PLN-18).
 */
export function wishPrefill(wish: Pick<Wish, 'left'>): bigint | null {
  const left = BigInt(wish.left);
  return left > 0n ? left : null;
}

/**
 * The date an expense for a wish starts on: today, or the last day of the
 * wish's month when that month is over.
 * @param month The wish's month, YYYY-MM.
 * @param today YYYY-MM-DD in the family time zone.
 */
export function wishDate(month: string, today: string): string {
  if (month >= today.slice(0, 7)) return today;
  const { year, month: m } = dateParts(`${month}-01`);
  return isoDate(year, m, new Date(Date.UTC(year, m, 0)).getUTCDate());
}

/**
 * The prefill in the paying account's currency at the day's rate: the same
 * amount in the wish's currency, the converted one, or null while the rate
 * is missing.
 */
export function convertedPrefill(
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
export function wishRateLine(
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

/**
 * A rate source holding the one rate the server gave for a pair, so the
 * shared `convert` gives the same amount the server would (UI-ADD-15).
 */
export function pairLookup(
  from: string,
  to: string,
  rate: DatedRate,
): RateLookup {
  return (base, quote) => (base === from && quote === to ? rate : undefined);
}

/**
 * Who set a category or envelope on the Add form: the member by hand, a
 * merchant rule, or nobody (UI-ADD-9).
 */
export type PickSource = 'hand' | 'rule';

/** A category or envelope field of the form; `id` null means empty. */
export interface FormPick {
  id: number | null;
  /** Null while the field is empty. */
  source: PickSource | null;
}

/** An empty field. */
export const EMPTY_PICK: FormPick = { id: null, source: null };

/**
 * Applies a merchant's rule to the category and envelope (UI-ADD-9; Design
 * 3.5): only a field that is empty or was filled by a rule changes, so a
 * value picked by hand is never overwritten. A merchant without a rule, or
 * a rule without an envelope, clears what an earlier rule set.
 */
export function applyRule(
  fields: { category: FormPick; envelope: FormPick },
  match: Pick<RuleMatch, 'categoryId' | 'envelopeId'> | null,
): { category: FormPick; envelope: FormPick } {
  const fill = (field: FormPick, id: number | null): FormPick => {
    if (field.source === 'hand') return field;
    return id === null ? EMPTY_PICK : { id, source: 'rule' };
  };
  return {
    category: fill(fields.category, match?.categoryId ?? null),
    envelope: fill(fields.envelope, match?.envelopeId ?? null),
  };
}

/**
 * Tapping a chip picks it by hand; tapping the selected chip clears it
 * (UI-ADD-5).
 */
export function toggleChip(field: FormPick, id: number): FormPick {
  return field.id === id ? EMPTY_PICK : { id, source: 'hand' };
}

/**
 * Puts `id` at the front of a chip row unless it is already in the row, so a
 * pick from an "All…" sheet stays visible (UI-NAV-7).
 */
export function withFront(row: readonly number[], id: number | null): number[] {
  if (id === null || row.includes(id)) return [...row];
  return [id, ...row];
}

/**
 * The label above the category or envelope chips (UI-ADD-9, UI-ADD-10):
 * "Category · from REWE rule" for a rule's value, "Category · optional ·
 * if empty, Groceries" when the other field's default would fill it on
 * save, and "Category · optional" otherwise.
 * @param field "Category" or "Envelope".
 * @param preview Name the on-save fill would give the empty field.
 */
export function pickLabel(
  field: 'Category' | 'Envelope',
  pick: FormPick,
  merchant: string,
  preview: string | null,
): string {
  if (pick.id !== null && pick.source === 'rule' && merchant) {
    return `${field} · from ${merchant} rule`;
  }
  if (pick.id === null && preview) {
    return `${field} · optional · if empty, ${preview}`;
  }
  return `${field} · optional`;
}

/**
 * What an expense counts for (UI-ADD-17): one choice among an envelope, a
 * wish of the date's month and neither. An empty choice is none of them.
 */
export interface CountsFor {
  envelope: FormPick;
  wishId: number | null;
  /** "Neither": no envelope and no wish, whatever the category's default. */
  unplanned: boolean;
}

/** Nothing chosen yet. */
export const EMPTY_COUNTS: CountsFor = {
  envelope: EMPTY_PICK,
  wishId: null,
  unplanned: false,
};

/** One thing the Counts for chips can show. */
export interface CountsRef {
  type: 'envelope' | 'wish' | 'none';
  /** 0 for `none`. */
  id: number;
}

/** The pick that makes `target` the choice, by hand; the rest is cleared. */
export function countsPick(target: CountsRef): CountsFor {
  if (target.type === 'envelope') {
    return {
      envelope: { id: target.id, source: 'hand' },
      wishId: null,
      unplanned: false,
    };
  }
  if (target.type === 'wish') {
    return { envelope: EMPTY_PICK, wishId: target.id, unplanned: false };
  }
  return { envelope: EMPTY_PICK, wishId: null, unplanned: true };
}

/** Whether `target` is the current choice. */
export function countsIs(current: CountsFor, target: CountsRef): boolean {
  if (target.type === 'envelope') return current.envelope.id === target.id;
  if (target.type === 'wish') return current.wishId === target.id;
  return current.unplanned;
}

/**
 * Tapping a chip picks it and clears the other kinds; tapping the selected
 * chip clears it (UI-ADD-17).
 */
export function toggleCounts(current: CountsFor, target: CountsRef): CountsFor {
  return countsIs(current, target) ? EMPTY_COUNTS : countsPick(target);
}

/**
 * The chips of the Counts for row (UI-ADD-17): the picked one leads, else
 * the envelope the category would fill, then the date's wishes, then the
 * other envelopes, cut at `limit`. "Unplanned" shows only while picked.
 * @param suggested The envelope the on-save fill would give, or null.
 */
export function countsChips(
  current: CountsFor,
  envelopeIds: readonly number[],
  wishIds: readonly number[],
  suggested: number | null,
  limit: number,
): CountsRef[] {
  const first: CountsRef[] =
    suggested !== null && envelopeIds.includes(suggested)
      ? [{ type: 'envelope', id: suggested }]
      : [];
  const rest: CountsRef[] = [
    ...wishIds.map((id): CountsRef => ({ type: 'wish', id })),
    ...envelopeIds
      .filter((id) => id !== suggested)
      .map((id): CountsRef => ({ type: 'envelope', id })),
  ];
  const row = [...first, ...rest].slice(0, limit);
  const picked: CountsRef | null = current.unplanned
    ? { type: 'none', id: 0 }
    : current.wishId !== null
      ? { type: 'wish', id: current.wishId }
      : current.envelope.id !== null
        ? { type: 'envelope', id: current.envelope.id }
        : null;
  if (!picked) return row;
  return [
    picked,
    ...row.filter((ref) => !(ref.type === picked.type && ref.id === picked.id)),
  ];
}

/**
 * The label above the Counts for chips (UI-ADD-17): "Counts for · optional",
 * "· optional · if empty, Groceries envelope", "· from REWE rule", "· a
 * wish, so no envelope" or "· no envelope and no wish".
 * @param preview Name of the envelope the on-save fill would give.
 */
export function countsForLabel(
  current: CountsFor,
  merchant: string,
  preview: string | null,
): string {
  if (current.wishId !== null) return 'Counts for · a wish, so no envelope';
  if (current.unplanned) return 'Counts for · no envelope and no wish';
  if (
    current.envelope.id !== null &&
    current.envelope.source === 'rule' &&
    merchant
  ) {
    return `Counts for · from ${merchant} rule`;
  }
  if (current.envelope.id === null && preview) {
    return `Counts for · optional · if empty, ${preview} envelope`;
  }
  return 'Counts for · optional';
}

/**
 * The hint at the end of the merchant field: "Optional" while empty, "Rule
 * applied · change" while a rule's value is on the form, else "Change".
 */
export function merchantHint(
  merchant: string,
  category: FormPick,
  envelope: FormPick,
): string {
  if (!merchant) return 'Optional';
  return category.source === 'rule' || envelope.source === 'rule'
    ? 'Rule applied · change'
    : 'Change';
}

/** The currency of an Add-options account, for the keypad and formatting. */
export function accountCurrency(account: AddOptionsAccount): Currency {
  const known = getCurrency(account.currency);
  if (known) return known;
  return {
    code: account.currency,
    name: account.currency,
    decimals: account.decimals,
    symbol: account.symbol,
    kind: getIsoCurrency(account.currency) ? 'fiat' : 'coin',
  };
}

/**
 * The big amount on the form: the currency symbol and "0" while nothing is
 * typed, as the design draws it, otherwise the formatted amount with a
 * U+2212 minus for a refund.
 */
export function amountText(amount: bigint | null, currency: Currency): string {
  return amount === null
    ? `${currency.symbol}0`
    : formatMoney(amount, currency);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Splits a YYYY-MM-DD date into numbers; month is 1–12. */
export function dateParts(date: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  return { year: year ?? 2000, month: month ?? 1, day: day ?? 1 };
}

/** Writes a calendar date as YYYY-MM-DD. */
export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(
    2,
    '0',
  )}-${String(day).padStart(2, '0')}`;
}

/** Day of the week of a calendar date, 0 for Sunday. */
export function weekday(date: string): number {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The calendar date `days` after `date` (negative goes back). */
export function shiftDate(date: string, days: number): string {
  const { year, month, day } = dateParts(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * The date as the Date tile and the saved summary show it: "Today",
 * "Yesterday", or the weekday, day and month ("Sat 3 Oct"), with the year
 * when it is not this year's.
 * @param today YYYY-MM-DD in the family time zone.
 * @example
 * dayLabel('2026-10-03', '2026-10-05'); // 'Sat 3 Oct'
 */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === shiftDate(today, -1)) return 'Yesterday';
  const { year, month, day } = dateParts(date);
  const label = `${WEEKDAYS[weekday(date)]} ${day} ${MONTHS[month - 1]}`;
  return year === dateParts(today).year ? label : `${label} ${year}`;
}

/**
 * What the saved screen says the on-save fill added (UI-ADD-11): "Groceries
 * envelope added from the Groceries category.", and the same for a category
 * taken from its envelope. Empty when nothing was filled.
 */
export function filledText(
  filled: {
    envelope?: 'category' | undefined;
    category?: 'envelope' | undefined;
  },
  categoryName: string | null,
  envelopeName: string | null,
): string {
  const parts: string[] = [];
  if (filled.envelope && envelopeName && categoryName) {
    parts.push(
      `${envelopeName} envelope added from the ${categoryName} category`,
    );
  }
  if (filled.category && envelopeName && categoryName) {
    parts.push(
      `${categoryName} category added from the ${envelopeName} envelope`,
    );
  }
  return parts.length ? `${parts.join('. ')}.` : '';
}

/**
 * The one-line summary on the saved screen (UI-ADD-13): "€23.80 · REWE ·
 * ING Visa · Groceries". The date and payer are named only when they are
 * not today and the signed-in profile; the category only when it differs
 * from the envelope's name. A transfer passes "ING Visa → Wise $" as the
 * account and "€20.00 → $21.86" as the amount.
 */
export function savedSummary(parts: {
  amount: string;
  merchant: string | null;
  date: string | null;
  payer: string | null;
  /** The person tile's label, lower-cased in front of the name. */
  payerLabel?: string;
  account: string;
  envelope: string | null;
  category: string | null;
}): string {
  const line = [parts.amount];
  if (parts.merchant) line.push(parts.merchant);
  if (parts.date) line.push(parts.date);
  if (parts.payer) {
    line.push(
      `${(parts.payerLabel ?? 'Paid by').toLowerCase()} ${parts.payer}`,
    );
  }
  line.push(parts.account);
  if (parts.envelope) line.push(parts.envelope);
  if (parts.category && parts.category !== parts.envelope) {
    line.push(parts.category);
  }
  return line.join(' · ');
}
