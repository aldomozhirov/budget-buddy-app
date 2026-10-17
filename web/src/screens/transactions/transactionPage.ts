import {
  getCurrency,
  todayInTimeZone,
  type CoinCurrency,
  type Transaction,
  type TransactionKind,
  type TransactionRevision,
} from '@budget-buddy/shared';
import { dateParts, dayLabel, shiftDate } from '../add/addForm.js';
import { money } from './transactionsFormat.js';

const MONTHS = [
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
];

/** The page title and the words that follow the kind (UI-TXN-4). */
export const PAGE_WORDS: Readonly<
  Record<
    TransactionKind,
    {
      title: string;
      /** "paid by" in the line under the merchant. */
      by: string;
      /** Label of the person row and title of its sheet. */
      payerLabel: string;
      /** The line in the person sheet. */
      payerHint: string;
      /** Label of the first account row. */
      fromLabel: string;
      /** Name of the thing for "Delete this …?". */
      noun: string;
    }
  >
> = {
  expense: {
    title: 'Expense',
    by: 'paid by',
    payerLabel: 'Paid by',
    payerHint: 'Who paid. The account stays as picked.',
    fromLabel: 'Paid from',
    noun: 'expense',
  },
  income: {
    title: 'Income',
    by: 'received by',
    payerLabel: 'Received by',
    payerHint: 'Who received the money.',
    fromLabel: 'Paid into',
    noun: 'income',
  },
  transfer: {
    title: 'Transfer',
    by: 'done by',
    payerLabel: 'Done by',
    payerHint: 'Who moved the money. The accounts stay as picked.',
    fromLabel: 'From',
    noun: 'transfer',
  },
};

/** The names the page needs, looked up by id (archived ones included). */
export interface PageNames {
  member: ReadonlyMap<number, string>;
  account: ReadonlyMap<number, { name: string; currency: string }>;
  category: ReadonlyMap<number, string>;
  envelope: ReadonlyMap<number, { name: string; currency: string }>;
}

/** An expense with a negative amount is a refund (TXN-8). */
export function isRefund(transaction: Transaction): boolean {
  return transaction.kind === 'expense' && BigInt(transaction.amount) < 0n;
}

/**
 * The big amount at the top: `−€64.20` for money that left, `+€19.99` for
 * a refund, `+€4,200.00` for income, the plain amount for a transfer.
 */
export function headerAmount(
  transaction: Transaction,
  coins: readonly CoinCurrency[],
): { text: string; tone: 'out' | 'in' | 'neutral' } {
  const amount = BigInt(transaction.amount);
  const code = transaction.currency;
  if (transaction.kind === 'transfer') {
    return { text: money(amount, code, coins), tone: 'neutral' };
  }
  if (transaction.kind === 'income' || amount < 0n) {
    return {
      text: `+${money(amount < 0n ? -amount : amount, code, coins)}`,
      tone: 'in',
    };
  }
  return { text: money(-amount, code, coins), tone: 'out' };
}

/** `Today, 5 October 2026`, `Yesterday, …`, or `2 October 2026`. */
export function longDate(date: string, today: string): string {
  const { year, month, day } = dateParts(date);
  const text = `${day} ${MONTHS[month - 1]} ${year}`;
  if (date === today) return `Today, ${text}`;
  if (date === shiftDate(today, -1)) return `Yesterday, ${text}`;
  return text;
}

/** The Date row's value, `DD/MM/YYYY`. */
export function slashDate(date: string): string {
  const { year, month, day } = dateParts(date);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(day)}/${two(month)}/${year}`;
}

/** `2 October`, with the year when it is not this year's. */
function dayAndMonth(date: string, today: string): string {
  const { year, month, day } = dateParts(date);
  const text = `${day} ${MONTHS[month - 1]}`;
  return year === dateParts(today).year ? text : `${text} ${year}`;
}

/**
 * Rounds a plain decimal rate for the page: four decimals from 1 up, four
 * significant digits below, without trailing zeros (`0.9149`, `0.0061`).
 */
export function rateText(rate: string): string {
  const [whole = '0', fraction = ''] = rate.split('.');
  const lead = /^0*/u.exec(fraction)?.[0].length ?? 0;
  const keep = whole.replace(/^0+/u, '') === '' ? lead + 4 : 4;
  let digits = `${whole}${fraction.slice(0, keep).padEnd(keep, '0')}`;
  if (fraction.length > keep && (fraction[keep] ?? '0') >= '5') {
    digits = (BigInt(digits) + 1n).toString();
  }
  digits = digits.padStart(keep + 1, '0');
  const text = `${digits.slice(0, -keep)}.${digits.slice(-keep)}`;
  return text.replace(/\.?0+$/u, '');
}

/** The symbol before an amount of this currency, or its code and a space. */
function symbolOf(code: string, coins: readonly CoinCurrency[]): string {
  return getCurrency(code, coins)?.symbol ?? `${code} `;
}

/** "At the rate of 2 October: $1 = €0.9149." (UI-TXN-5). */
export function rateLine(
  rate: NonNullable<Transaction['envelopeRate']>,
  coins: readonly CoinCurrency[],
  today: string,
): string {
  return (
    `At the rate of ${dayAndMonth(rate.date, today)}: ` +
    `${symbolOf(rate.from, coins)}1 = ` +
    `${symbolOf(rate.to, coins)}${rateText(rate.rate)}.`
  );
}

/** Whether an expense's envelope counts in another currency (UI-TXN-5). */
export function countsInOtherCurrency(transaction: Transaction): boolean {
  return (
    transaction.kind === 'expense' &&
    transaction.envelopeId !== null &&
    transaction.envelopeCurrency !== null &&
    transaction.envelopeCurrency !== transaction.currency
  );
}

/**
 * The envelope amount as shown ("€21.40"): a refund's is negative in the
 * data and shown without its sign, as on the keypad.
 */
export function countsAsText(
  transaction: Transaction,
  coins: readonly CoinCurrency[],
): string {
  if (transaction.envelopeAmount === null) return '';
  const amount = BigInt(transaction.envelopeAmount);
  return money(
    amount < 0n ? -amount : amount,
    transaction.envelopeCurrency ?? transaction.currency,
    coins,
  );
}

/** The sheet's line under "Counts in the envelope as" (3.3, UI-TXN-5). */
export function countsHint(
  transaction: Transaction,
  coins: readonly CoinCurrency[],
  today: string,
): string {
  if (transaction.envelopeAmountManual) {
    return (
      'Typed by hand. It changes again if the amount, date, account or ' +
      'envelope changes.'
    );
  }
  if (transaction.envelopeRate) {
    return (
      `${rateLine(transaction.envelopeRate, coins, today)} ` +
      'Type what the bank charged, if you know it.'
    );
  }
  return (
    'No rate for this date yet. Type what the bank charged, if you ' +
    'know it.'
  );
}

/** What the Envelope row shows: the name, and "counts as" across currencies. */
export function envelopeRowText(
  transaction: Transaction,
  name: string | undefined,
  coins: readonly CoinCurrency[],
): string {
  if (transaction.envelopeId === null) return 'None';
  const label = name ?? 'Envelope';
  if (!countsInOtherCurrency(transaction)) return label;
  const counts = countsAsText(transaction, coins);
  return counts ? `${label} · counts as ${counts}` : `${label} · rate missing`;
}

/**
 * The question in the delete confirmation (UI-TXN-8): what goes back where.
 * @param envelopeName The expense's envelope; undefined for none.
 */
export function deleteText(
  transaction: Transaction,
  envelopeName: string | undefined,
  coins: readonly CoinCurrency[],
): string {
  if (transaction.kind !== 'expense') return 'This can’t be undone.';
  if (transaction.envelopeId === null) {
    return 'It’s in no envelope. This can’t be undone.';
  }
  const name = envelopeName ?? 'its envelope';
  const refund = isRefund(transaction);
  const counts = countsInOtherCurrency(transaction)
    ? countsAsText(transaction, coins)
    : money(
        refund ? -BigInt(transaction.amount) : BigInt(transaction.amount),
        transaction.currency,
        coins,
      );
  if (countsInOtherCurrency(transaction) && counts === '') {
    return `It goes back into ${name}. This can’t be undone.`;
  }
  return refund
    ? `${counts} comes out of ${name} again. This can’t be undone.`
    : `${counts} goes back into ${name}. This can’t be undone.`;
}

/** The clock time of an instant in the family time zone, `14:30`. */
function clockTime(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(instant));
}

/**
 * When something happened: `12:04` today, `Yesterday · 12:04`, or
 * `2 Oct · 18:42` (with the year outside this year).
 */
export function whenText(
  instant: number,
  timeZone: string,
  today: string,
): string {
  const date = todayInTimeZone(new Date(instant), timeZone);
  const time = clockTime(instant, timeZone);
  if (date === today) return time;
  if (date === shiftDate(today, -1)) return `Yesterday · ${time}`;
  return `${dayLabel(date, today).replace(/^\w+ /u, '')} · ${time}`;
}

/** One line of the Record (UI-TXN-7). */
export interface RecordLine {
  key: string;
  text: string;
  when: string;
}

/**
 * The Record (MEM-5, UI-TXN-7): who typed the transaction and when, then
 * every change in words, oldest first. Names are today's names, and an
 * amount reads in the currency of the account (or envelope) it had at that
 * revision, found by walking the changes back from today's values.
 */
export function recordLines(
  transaction: Transaction,
  revisions: readonly TransactionRevision[],
  names: PageNames,
  coins: readonly CoinCurrency[],
  timeZone: string,
  today: string,
): RecordLine[] {
  const member = (id: number | null) =>
    id === null ? 'someone' : (names.member.get(id) ?? 'someone');
  const lines: RecordLine[] = [
    {
      key: 'typed',
      text: `Typed in by ${member(transaction.createdBy)}`,
      when: whenText(
        transaction.enteredAt ?? transaction.createdAt,
        timeZone,
        today,
      ),
    },
  ];

  // The currency each revision's amounts were in, newest revision first.
  let accountId: number | null = transaction.accountId;
  let toAccountId: number | null = transaction.toAccountId;
  let envelopeId: number | null = transaction.envelopeId;
  const currencies = new Map<
    number,
    { account: string; to: string; envelope: string }
  >();
  for (const revision of [...revisions].reverse()) {
    currencies.set(revision.id, {
      account:
        (accountId !== null ? names.account.get(accountId)?.currency : null) ??
        transaction.currency,
      to:
        (toAccountId !== null
          ? names.account.get(toAccountId)?.currency
          : null) ??
        transaction.toCurrency ??
        transaction.currency,
      envelope:
        (envelopeId !== null
          ? names.envelope.get(envelopeId)?.currency
          : null) ??
        transaction.envelopeCurrency ??
        transaction.currency,
    });
    accountId = revision.changes.accountId?.[0] ?? accountId;
    toAccountId = revision.changes.toAccountId?.[0] ?? toAccountId;
    envelopeId = revision.changes.envelopeId?.[0] ?? envelopeId;
  }

  for (const revision of revisions) {
    if (revision.action !== 'update') continue;
    const by = member(revision.changedBy);
    const when = whenText(revision.changedAt, timeZone, today);
    const unit = currencies.get(revision.id);
    const changes = revision.changes;
    const words: string[] = [];
    const set = (label: string, value: string | null | undefined) =>
      words.push(
        value === null || value === undefined || value === ''
          ? `${label} removed`
          : `${label} changed to ${value}`,
      );
    const amountWords = (label: string, value: string, code: string) => {
      const amount = BigInt(value);
      words.push(
        `${label} changed to ${money(amount < 0n ? -amount : amount, code, coins)}`,
      );
    };
    if (changes.amount?.[1] != null)
      amountWords('Amount', changes.amount[1], unit?.account ?? '');
    if (changes.toAmount?.[1] != null)
      amountWords('Amount that arrives', changes.toAmount[1], unit?.to ?? '');
    if (changes.accountId)
      set('Account', names.account.get(changes.accountId[1] ?? 0)?.name);
    if (changes.toAccountId)
      set('To account', names.account.get(changes.toAccountId[1] ?? 0)?.name);
    if (changes.merchant) set('Merchant', changes.merchant[1]);
    if (changes.categoryId)
      set('Category', names.category.get(changes.categoryId[1] ?? 0));
    if (changes.envelopeId)
      set('Envelope', names.envelope.get(changes.envelopeId[1] ?? 0)?.name);
    if (changes.envelopeAmount?.[1] != null)
      amountWords(
        'Envelope amount',
        changes.envelopeAmount[1],
        unit?.envelope ?? '',
      );
    if (changes.date?.[1] != null)
      set('Date', dayLabel(changes.date[1], today));
    if (changes.memberId)
      set(
        PAGE_WORDS[transaction.kind].payerLabel,
        names.member.get(changes.memberId[1] ?? 0),
      );
    if (changes.note) {
      words.push(changes.note[1] ? 'Note changed' : 'Note removed');
    }
    words.forEach((text, index) =>
      lines.push({
        key: `r${revision.id}-${index}`,
        text: `${text} by ${by}`,
        when,
      }),
    );
  }
  return lines;
}
