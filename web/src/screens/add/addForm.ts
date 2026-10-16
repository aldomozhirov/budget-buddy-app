import {
  formatMoney,
  getCurrency,
  getIsoCurrency,
  type AddOptionsAccount,
  type Currency,
  type RuleMatch,
} from '@budget-buddy/shared';

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
 * from the envelope's name.
 */
export function savedSummary(parts: {
  amount: string;
  merchant: string | null;
  date: string | null;
  payer: string | null;
  account: string;
  envelope: string | null;
  category: string | null;
}): string {
  const line = [parts.amount];
  if (parts.merchant) line.push(parts.merchant);
  if (parts.date) line.push(parts.date);
  if (parts.payer) line.push(`paid by ${parts.payer}`);
  line.push(parts.account);
  if (parts.envelope) line.push(parts.envelope);
  if (parts.category && parts.category !== parts.envelope) {
    line.push(parts.category);
  }
  return line.join(' · ');
}
