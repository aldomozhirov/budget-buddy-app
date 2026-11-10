import { describe, expect, it } from 'vitest';
import { evaluateExpression, getCurrency, parsePastedAmount, type Currency } from '../src/money/index.js';

const currency = (code: string): Currency => {
  const found = getCurrency(code, [{ code: 'BTC', name: 'Bitcoin', decimals: 8 }]);
  if (!found) throw new Error(`Test currency unavailable: ${code}`);
  return found;
};
const eur = currency('EUR');
const rub = currency('RUB');
const usd = currency('USD');
const kwd = currency('KWD');
const jpy = currency('JPY');
const chf = currency('CHF');
const btc = currency('BTC');

describe('pasted amounts', () => {
  it.each([
    ['€1,234.56', eur, '1234.56'],
    ['1 234,56 ₽', rub, '1234.56'],
    ['1 234,56 ₽', rub, '1234.56'],
    ['1 234,56 руб.', rub, '1234.56'],
    ['1.234,56 EUR', eur, '1234.56'],
    ['−12,30 €', eur, '−12.30'],
    ['-12.30', eur, '−12.30'],
    ['–12,30 €', eur, '−12.30'],
    ['12,30-', eur, '−12.30'],
    ['+1.500,00 €', eur, '1500.00'],
    ['USD 5', usd, '5'],
    ['$0.99', usd, '0.99'],
    ['1,234', eur, '1234'],
    ['1.234', eur, '1234'],
    ['1,234,567', usd, '1234567'],
    ['1.234.567,89 €', eur, '1234567.89'],
    ['0,123', eur, '0.123'],
    ['1234,567', eur, '1234.567'],
    ['12,5', jpy, '12.5'],
    ['1,234', jpy, '1234'],
    ['1,234', kwd, '1.234'],
    ["CHF 1'234.50", chf, '1234.50'],
    ['1’234.50 CHF', chf, '1234.50'],
    ['0.12345678 BTC', btc, '0.12345678'],
    ['₿1.234', btc, '1.234'],
    ['  42  ', eur, '42'],
    ['- 12,30 €', eur, '−12.30'],
    ['€ 1 234 567,89', eur, '1234567.89'],
    ['1\u2009234.56', usd, '1234.56'],
    ['EUR 0,50', eur, '0.50'],
  ])('reads %j in %s as %j', (text, money, expression) => {
    expect(parsePastedAmount(text, money)).toEqual({ ok: true, expression });
  });

  it.each([
    [''],
    ['   '],
    ['Groceries'],
    ['€'],
    ['12.30 and 4.50'],
    ['Total: 12.30'],
    ['12.30 / 4.50'],
    ['1.2.3'],
    ['1,23,456'],
    ['1.234.56,7'],
    ['--5'],
    ['-5-'],
    ['5 - 3'],
    ['.50'],
    ['12.'],
    ['1e5x6'],
    ['5 12'],
    ['5\t12'],
    ['5\n12'],
    ['5\r\n12'],
    ['5  12'],
    ['5 \t 12'],
    ['5\n\n12'],
    ['€5  €12'],
    ['1  234'],
    ['5, 12'],
    ['10, 20'],
    ['5,\n12'],
    ['1, 234'],
    ['5 .12'],
    ['€5 €12'],
    ['1 5'],
    ['12,30 4,560'],
    ['1234 567'],
    ['0.000.001'],
    ['00,123'],
    ['(12.30)'],
    ['₹1,23,456.00'],
    ['31.10.2026'],
    ['2026-10-31'],
    ['1.234,'],
    ['+-5'],
    ['1_000'],
    ['EUR.50'],
    [`1${' '.repeat(200)}`],
    [`1${'x'.repeat(40_000)}2`],
  ])('rejects %j', (text) => {
    expect(parsePastedAmount(text, eur)).toEqual({ ok: false });
  });

  it('leaves rounding to the keypad evaluator', () => {
    const pasted = parsePastedAmount('€1,234.565', eur);
    expect(pasted).toEqual({ ok: true, expression: '1234.565' });
    if (!pasted.ok) return;
    expect(evaluateExpression(pasted.expression, eur)).toEqual({ ok: true, value: 123457n });
  });

  it('keeps every digit of an amount above 2^53', () => {
    const pasted = parsePastedAmount('92.233.720.368.547.758,07 €', eur);
    expect(pasted).toEqual({ ok: true, expression: '92233720368547758.07' });
    if (!pasted.ok) return;
    expect(evaluateExpression(pasted.expression, eur)).toEqual({ ok: true, value: 9223372036854775807n });
  });
});
