import { describe, expect, it } from 'vitest';
import { addMonths, monthOfDate, monthsBetween } from '../src/index.js';

describe('envelope months', () => {
  it('adds months across year ends, both ways', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2024-02', 12)).toBe('2025-02');
    expect(addMonths('2026-10', -22)).toBe('2024-12');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
  });

  it('takes the month of a date, leap day included', () => {
    expect(monthOfDate('2024-02-29')).toBe('2024-02');
    expect(monthOfDate('2026-12-31')).toBe('2026-12');
    expect(() => monthOfDate('2026-13-01')).toThrow(RangeError);
  });

  it('lists the months between two months, both included', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthsBetween('2026-11', '2026-11')).toEqual(['2026-11']);
    expect(monthsBetween('2026-11', '2026-10')).toEqual([]);
  });

  it('refuses a malformed month', () => {
    expect(() => addMonths('2026-1', 1)).toThrow(RangeError);
    expect(() => monthsBetween('2026-00', '2026-02')).toThrow(RangeError);
    expect(() => monthsBetween('2026-01', '2026-13')).toThrow(RangeError);
  });
});
