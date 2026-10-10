import { describe, expect, it } from 'vitest';
import {
  classifyExpressionError,
  evaluateExpression,
  formatChange,
  formatMoney,
  getCurrency,
  getIsoCurrency,
  ISO_4217_CODES,
  lastCompleteValue,
  listCurrencies,
  parseMinor,
  roundHalfAwayFromZero,
  toMinorString,
  type Currency,
  type RateLookup,
  convert,
} from '../src/money/index.js';

const eur = getCurrency('EUR');
const jpy = getCurrency('JPY');
const btc = getCurrency('BTC', [{ code: 'BTC', name: 'Bitcoin', decimals: 8 }]);
if (!eur || !jpy || !btc) throw new Error('Test currencies unavailable');

describe('currency table and lookup', () => {
  it('bundles ISO currencies with ISO minor units and returns case-insensitive lookups', () => {
    expect(ISO_4217_CODES.length).toBeGreaterThan(150);
    expect(getIsoCurrency('EUR')).toMatchObject({ code: 'EUR', decimals: 2 });
    expect(getIsoCurrency('JPY')).toMatchObject({ code: 'JPY', decimals: 0 });
    expect(getIsoCurrency('UYI')).toMatchObject({ code: 'UYI', decimals: 0 });
    expect(getIsoCurrency('XCG')).toMatchObject({ code: 'XCG', decimals: 2 });
    expect(getIsoCurrency('ZWG')).toMatchObject({ code: 'ZWG', decimals: 2 });
    expect(getCurrency('eur')).toMatchObject({ code: 'EUR', decimals: 2, kind: 'fiat' });
    expect(getCurrency('unknown')).toBeUndefined();
  });

  it('uses coin decimals and symbols, rejects unsupported precision, and excludes ISO-code coin duplicates', () => {
    expect(getCurrency('btc', [{ code: 'BTC', name: 'Bitcoin', decimals: 8 }])).toMatchObject({
      code: 'BTC', decimals: 8, kind: 'coin', symbol: '₿',
    });
    expect(getCurrency('XYZ', [{ code: 'XYZ', name: 'Example', decimals: 2 }])).toMatchObject({
      code: 'XYZ', symbol: 'XYZ', kind: 'coin',
    });
    expect(() => getCurrency('TOO', [{ code: 'TOO', name: 'Too precise', decimals: 9 }])).toThrow(/between 0 and 8/);
    expect(listCurrencies([{ code: 'EUR', name: 'duplicate', decimals: 2 }]).filter(({ code }) => code === 'EUR')).toHaveLength(1);
    expect(listCurrencies([{ code: 'btc', name: 'Bitcoin', decimals: 8 }]).find(({ kind }) => kind === 'coin')).toMatchObject({
      code: 'BTC', symbol: '₿', kind: 'coin',
    });
    expect(() => listCurrencies([{ code: 'TOO', name: 'Too precise', decimals: 9 }])).toThrow(/between 0 and 8/);
  });

  it('leaves non-money ISO codes out of the picker list but still resolves them', () => {
    const listed = new Set(listCurrencies().map(({ code }) => code));
    for (const code of ['XAU', 'XAG', 'XDR', 'XTS', 'XXX']) {
      expect(listed.has(code), code).toBe(false);
      expect(getCurrency(code)?.kind, code).toBe('fiat');
    }
    for (const code of ['EUR', 'XAF', 'XOF', 'XCD']) expect(listed.has(code), code).toBe(true);
  });
});

describe('minor-unit and rounding rules', () => {
  it('parses and serializes signed minor-unit strings exactly, including values above 2^53', () => {
    const exact = '90071992547409931';
    expect(parseMinor(exact)).toBe(90071992547409931n);
    expect(toMinorString(parseMinor(exact))).toBe(exact);
    expect(parseMinor('-0')).toBe(0n);
    expect(() => parseMinor('')).toThrow();
    expect(() => parseMinor('1.0')).toThrow();
    expect(() => parseMinor('+1')).toThrow();
    expect(() => parseMinor('1'.repeat(20))).toThrow(RangeError);
    expect(parseMinor('9223372036854775807')).toBe(2n ** 63n - 1n);
    expect(parseMinor('-9223372036854775808')).toBe(-(2n ** 63n));
    expect(() => parseMinor('9223372036854775808')).toThrow(/too large/);
    expect(() => parseMinor('-9223372036854775809')).toThrow(/too large/);
    expect(toMinorString(-(2n ** 63n))).toBe('-9223372036854775808');
    expect(() => toMinorString(2n ** 63n)).toThrow(/too large/);
  });

  it('rounds half away from zero and validates decimal precision', () => {
    expect(roundHalfAwayFromZero('0.005', 2)).toBe(1n);
    expect(roundHalfAwayFromZero('-0.005', 2)).toBe(-1n);
    expect(roundHalfAwayFromZero('1.234', 2)).toBe(123n);
    expect(roundHalfAwayFromZero('-1.235', 2)).toBe(-124n);
    expect(() => roundHalfAwayFromZero('1', -1)).toThrow(RangeError);
    expect(() => roundHalfAwayFromZero('abc', 2)).toThrow(RangeError);
    expect(() => roundHalfAwayFromZero(Infinity, 2)).toThrow(RangeError);
  });
});

describe('expression evaluator', () => {
  const evaluate = (expression: string, currency: Currency = eur) => evaluateExpression(expression, currency);

  it.each([
    ['empty input', '', 'incomplete'],
    ['operator without a number', '+', 'incomplete'],
    ['trailing operator', '1+', 'incomplete'],
    ['decimal point alone', '.', 'incomplete'],
    ['decimal point after an operator', '1+.', 'incomplete'],
    ['open bracket', '(1+2', 'incomplete'],
    ['unclosed empty bracket', '(', 'incomplete'],
    ['stray close bracket', '1)', 'brackets'],
    ['empty brackets', '()', 'brackets'],
    ['adjacent bracket groups', '(1)(2', 'other'],
    ['implicit multiplication after a number', '1(2+', 'other'],
    ['open bracket with division by zero', '(5/0', 'incomplete'],
    ['division by zero before a stray close bracket', '5/0)', 'brackets'],
    ['division by zero', '5/0', 'division-by-zero'],
    ['overflow', '92233720368547758.08', 'too-large'],
    ['invalid number', '1..2', 'other'],
  ] as const)(
    'classifies %s as %s',
    (_description, expression, expected) => {
      const result = evaluate(expression);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(classifyExpressionError(expression, result.reason)).toBe(expected);
      }
    },
  );

  it('evaluates the required percentage expression and rounds repeating decimals once to currency precision', () => {
    expect(evaluate('(11244.14 + 12441.12) / 2 * 10%')).toEqual({ ok: true, value: 118426n });
    expect(evaluate('1/3')).toEqual({ ok: true, value: 33n });
    expect(evaluate('2/3')).toEqual({ ok: true, value: 67n });
    expect(evaluate('1/3', jpy)).toEqual({ ok: true, value: 0n });
  });

  it('accepts unary minus and typographic operators and applies currency-specific decimal places', () => {
    expect(evaluate('-1.25')).toEqual({ ok: true, value: -125n });
    expect(evaluate('−(1.25)')).toEqual({ ok: true, value: -125n });
    expect(evaluate('(1 + 2) × 4 ÷ 2')).toEqual({ ok: true, value: 600n });
    expect(evaluate('1.5', jpy)).toEqual({ ok: true, value: 2n });
    expect(evaluate('1.5', getCurrency('UYI')!)).toEqual({ ok: true, value: 2n });
    expect(evaluate('0.00000001', btc)).toEqual({ ok: true, value: 1n });
  });

  it.each([
    ['empty input', ''],
    ['unclosed bracket', '(1+2'],
    ['division by zero', '5/0'],
    ['trailing operator', '1+'],
    ['unexpected close bracket', '1+2)'],
    ['invalid numeric literal', '1..2'],
    ['invalid character', '1e3'],
    ['overflow', '100000000000000000000'],
  ])('rejects %s with a reason', (_description, expression) => {
    const result = evaluate(expression);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('keeps integer values above 2^53 exact and returns partial values only for open operations', () => {
    expect(evaluate('9007199254740993')).toEqual({ ok: true, value: 900719925474099300n });
    expect(lastCompleteValue('1 +', eur)).toBe(100n);
    expect(lastCompleteValue('(1 + 2', eur)).toBe(300n);
    expect(lastCompleteValue('1 + 2', eur)).toBeUndefined();
  });

  it('keeps results up to the 64-bit limit exact and evaluates balanced groups before an open operator', () => {
    expect(evaluate('(92233720368547758.07 * 2) / 2')).toEqual({
      ok: true,
      value: 9223372036854775807n,
    });
    expect(evaluate('92233720368547758.08')).toEqual({ ok: false, reason: 'Amount is too large' });
    expect(lastCompleteValue('1*(2+3)+', eur)).toBe(500n);
    expect(lastCompleteValue('2*(3+4+', eur)).toBe(1400n);
  });

  it('previews the value before a bracket that was just opened', () => {
    expect(lastCompleteValue('1 + (', eur)).toBe(100n);
    expect(lastCompleteValue('2 * (1 + (', eur)).toBe(200n);
    expect(lastCompleteValue('(', eur)).toBeUndefined();
  });

  it('previews the last complete value before an incomplete decimal point', () => {
    expect(lastCompleteValue('1+.', eur)).toBe(100n);
    expect(lastCompleteValue('.', eur)).toBeUndefined();
  });
});

describe('money formatting', () => {
  it('formats exact amounts using currency decimals and the U+2212 minus sign', () => {
    expect(formatMoney(-1450n, eur)).toBe('−€14.50');
    expect(formatMoney(123456789n, eur)).toBe('€1,234,567.89');
    expect(formatMoney(1234n, jpy)).toBe('¥1,234');
    expect(formatMoney(1n, btc)).toBe('₿0.00000001');
    expect(formatMoney(-1n, btc)).toBe('−₿0.00000001');
  });

  it('formats signed changes and zero consistently', () => {
    expect(formatChange(174200n, eur)).toBe('▲ €1,742.00');
    expect(formatChange(-470000n, getCurrency('RUB')!)).toBe('▼ ₽4,700.00');
    expect(formatChange(0n, eur)).toBe('Unchanged');
  });
});

describe('rate conversion', () => {
  const currency = (code: string): Currency => getCurrency(code) ?? { code, name: code, decimals: 2, kind: 'coin', symbol: code };

  it('uses nearest on-or-before rate via the lookup and returns the selected rate date', () => {
    const rows = [
      { base: 'USD', quote: 'EUR', rate: '0.9', date: '2026-01-01' },
      { base: 'USD', quote: 'EUR', rate: '0.8', date: '2026-02-01' },
    ];
    const lookup: RateLookup = (base, quote, requested) => rows
      .filter((row) => row.base === base && row.quote === quote && row.date <= requested)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    expect(convert(100n, currency('USD'), eur, '2026-02-20', lookup)).toEqual({ value: 80n, rateDate: '2026-02-01' });
    expect(convert(100n, currency('USD'), eur, '2025-12-31', lookup)).toEqual({ missing: true });
  });

  it('converts through a pivot using exact decimal rates and rounds only once to cents', () => {
    const rates = new Map([
      ['AAA:EUR', { rate: '1.2345', date: '2026-01-03' }],
      ['EUR:BBB', { rate: '2.3456', date: '2026-01-02' }],
    ]);
    const lookup: RateLookup = (base, quote) => rates.get(`${base}:${quote}`);
    // 1.00 AAA × 1.2345 EUR/AAA × 2.3456 BBB/EUR = 2.8950432 BBB.
    expect(convert(100n, currency('AAA'), currency('BBB'), '2026-01-04', lookup, ['EUR'])).toEqual({
      value: 290n, rateDate: '2026-01-02',
    });
  });

  it('supports inverse quotes and same-currency decimal rescaling', () => {
    const inverseOnly: RateLookup = (base, quote) => base === 'EUR' && quote === 'USD'
      ? { rate: '2', date: '2026-04-01' }
      : undefined;
    expect(convert(100n, currency('USD'), eur, '2026-04-02', inverseOnly)).toEqual({ value: 50n, rateDate: '2026-04-01' });
    expect(convert(-150n, eur, jpy, '2026-04-02', (base, quote) => base === 'EUR' && quote === 'JPY'
      ? { rate: '1', date: '2026-04-01' }
      : undefined)).toEqual({ value: -2n, rateDate: '2026-04-01' });
  });

  it.each([
    ['zero direct rate', 'USD', 'EUR', '0'],
    ['negative direct rate', 'USD', 'EUR', '-1'],
    ['non-finite direct rate', 'USD', 'EUR', 'Infinity'],
    ['not-a-number direct rate', 'USD', 'EUR', 'NaN'],
    ['malformed direct decimal', 'USD', 'EUR', '1.2.3'],
    ['zero inverse rate', 'EUR', 'USD', '0'],
    ['non-finite inverse rate', 'EUR', 'USD', 'Infinity'],
  ] as const)('rejects a %s', (_description, base, quote, rate) => {
    expect(() => convert(100n, currency('USD'), eur, '2026-01-01', (lookupBase, lookupQuote) =>
      lookupBase === base && lookupQuote === quote ? { rate, date: '2025-12-01' } : undefined)).toThrow(/finite positive/);
  });
});
