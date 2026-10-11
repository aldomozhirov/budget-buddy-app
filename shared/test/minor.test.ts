import { expect, it } from 'vitest';
import {
  formatMinorDecimal,
  MAX_MINOR,
  MIN_MINOR,
  parseMinor,
} from '../src/money/minor.js';

it('reports overlong integer amounts outside SQLite range as too large', () => {
  expect(() => parseMinor('9'.repeat(20))).toThrow('Amount is too large');
});

it('writes minor units as exact decimal strings in major units', () => {
  expect(formatMinorDecimal(-198630n, 2)).toBe('-1986.30');
  expect(formatMinorDecimal(5n, 2)).toBe('0.05');
  expect(formatMinorDecimal(-5n, 2)).toBe('-0.05');
  expect(formatMinorDecimal(0n, 2)).toBe('0.00');
  expect(formatMinorDecimal(1234n, 0)).toBe('1234');
  expect(formatMinorDecimal(-1n, 8)).toBe('-0.00000001');
  expect(formatMinorDecimal(123456789n, 8)).toBe('1.23456789');
});

it('keeps every digit of the largest and smallest amounts', () => {
  expect(formatMinorDecimal(MAX_MINOR, 2)).toBe('92233720368547758.07');
  expect(formatMinorDecimal(MIN_MINOR, 2)).toBe('-92233720368547758.08');
  expect(formatMinorDecimal(MIN_MINOR, 0)).toBe('-9223372036854775808');
});

it('rejects decimals outside 0 to 8', () => {
  expect(() => formatMinorDecimal(1n, 9)).toThrow(RangeError);
  expect(() => formatMinorDecimal(1n, -1)).toThrow(RangeError);
  expect(() => formatMinorDecimal(1n, 1.5)).toThrow(RangeError);
});
