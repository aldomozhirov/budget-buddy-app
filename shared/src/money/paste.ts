import type { Currency } from './currency.js';

/**
 * Outcome of reading pasted text as an amount: a plain expression literal
 * for the keypad, or a failure when the text is more than one amount.
 */
export type PasteResult = { readonly ok: true; readonly expression: string } | { readonly ok: false };

/**
 * An optional sign, the number, and an optional sign after it. Minus signs a
 * bank app may copy are the hyphen-minus, U+2212 and the en dash.
 */
const SIGNED = /^([+\-−–]?)([\d.,]+)([-−–]?)$/u;

/** Digits grouped in threes after a first group of one to three digits. */
const GROUPED = /^[1-9]\d{0,2}(?:[.,]\d{3})+$/u;

/** A number whose thousands are grouped by spaces, with any sign. */
const SPACE_GROUPED = /^[+\-−–]?[1-9]\d{0,2}(?: \d{3})+(?:[.,]\d+)?[-−–]?$/u;

/** Longer text is not one amount; it also keeps every check fast. */
const MAX_LENGTH = 100;

/**
 * Reads text copied from a banking app or a document as one amount of
 * `currency`, as the keypad would take it: digits, an optional `.` decimal
 * point and a leading U+2212 minus. The digits are kept exactly; rounding to
 * the currency's decimals stays with `evaluateExpression` (UI-AMT-3).
 *
 * - Currency symbols and letters (codes such as `EUR`, words such as
 *   `руб.`, with a dot that ends them) are removed, and so are spaces next
 *   to them or to a sign. A space between digits groups thousands
 *   (`1 234,56`); any other space, tab or line break between digits fails,
 *   so two amounts copied together are never read as one.
 * - A `-`, `−` or `–` before or after the number makes it negative; a `+`
 *   before it is ignored.
 * - With both `.` and `,`, the last one is the decimal mark and the other
 *   groups thousands. One kind used more than once groups thousands.
 * - One mark between one to three digits and exactly three digits groups
 *   thousands (`1,234` → `1234`), unless the currency has three or more
 *   decimals or the number starts with `0`; then it is the decimal mark.
 *   A grouped number never starts with `0`.
 * - Apostrophes group thousands (`1'234.50`).
 * - Anything else, such as two numbers or a word between digits, fails.
 * @example
 * parsePastedAmount('1 234,56 ₽', getCurrency('RUB')!);
 * // { ok: true, expression: '1234.56' }
 * parsePastedAmount('−12,30 €', getCurrency('EUR')!);
 * // { ok: true, expression: '−12.30' }
 * parsePastedAmount('1,234', getCurrency('EUR')!);
 * // { ok: true, expression: '1234' }
 */
export function parsePastedAmount(text: string, currency: Currency): PasteResult {
  if (text.length > MAX_LENGTH) return { ok: false };
  // A code or word goes before or after the number, never inside it.
  const first = text.search(/\d/u);
  let last = text.length - 1;
  while (last > first && !/\d/u.test(text[last] ?? '')) last -= 1;
  if (first >= 0 && /\p{L}/u.test(text.slice(first, last + 1))) return { ok: false };

  const bare = text
    .replace(/\p{L}+(?:\.(?!\d))?/gu, '')
    .replace(/[\p{Sc}'’]/gu, '')
    // A run of spaces inside the number is kept, so only grouping passes.
    .replace(/\s+/gu, (run, at: number, all: string) =>
      /[\d.,]/u.test(all[at - 1] ?? '') && /[\d.,]/u.test(all[at + run.length] ?? '') ? run : '');
  let stripped = bare;
  if (/\s/u.test(bare)) {
    const spaced = bare.replace(/[\u00a0\u2009\u202f]/gu, ' ');
    if (!SPACE_GROUPED.test(spaced)) return { ok: false };
    stripped = spaced.replaceAll(' ', '');
  }
  const match = SIGNED.exec(stripped);
  if (!match) return { ok: false };
  const [, before = '', body = '', after = ''] = match;
  if (before !== '' && after !== '') return { ok: false };
  const negative = (before !== '' && before !== '+') || after !== '';
  const number = readNumber(body, currency.decimals);
  if (number === undefined) return { ok: false };
  return { ok: true, expression: `${negative ? '−' : ''}${number}` };
}

/**
 * Reads digits with `.` and `,` marks as `whole` or `whole.fraction`, or
 * `undefined` when the marks cannot be read as one number.
 */
function readNumber(body: string, decimals: number): string | undefined {
  if (!/^\d/u.test(body) || !/\d$/u.test(body) || /^0\d/u.test(body)) return undefined;
  const dots = body.split('.').length - 1;
  const commas = body.split(',').length - 1;
  if (dots === 0 && commas === 0) return body;

  let mark: '.' | ',' | undefined;
  if (dots > 0 && commas > 0) {
    mark = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
    if ((mark === '.' ? dots : commas) > 1) return undefined;
  } else if (dots + commas === 1) {
    const [whole = '', fraction = ''] = body.split(/[.,]/u);
    const grouping = fraction.length === 3 && decimals < 3 && /^[1-9]\d{0,2}$/u.test(whole);
    mark = grouping ? undefined : dots === 1 ? '.' : ',';
  }

  const at = mark === undefined ? body.length : body.lastIndexOf(mark);
  const whole = body.slice(0, at);
  const fraction = body.slice(at + 1);
  if ((whole.includes('.') || whole.includes(',')) && !GROUPED.test(whole)) return undefined;
  const digits = whole.replace(/[.,]/gu, '');
  return mark === undefined ? digits : `${digits}.${fraction}`;
}
