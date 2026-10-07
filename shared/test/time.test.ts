import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  compareLocalDates,
  endOfLocalDay,
  formatDate,
  formatRecentDate,
  getCadenceSlots,
  todayInTimeZone,
} from '../src/time/index.js';

const berlin = 'Europe/Berlin';

describe('time-zone-aware calendar helpers', () => {
  it('gets today from the configured zone rather than UTC', () => {
    expect(todayInTimeZone(new Date('2026-01-01T23:30:00.000Z'), berlin)).toBe('2026-01-02');
    expect(todayInTimeZone(new Date('2026-07-01T21:59:00.000Z'), berlin)).toBe('2026-07-01');
  });

  it('returns the final instant of a local day across normal, spring-forward and fall-back days', () => {
    expect(new Date(endOfLocalDay('2026-01-15', berlin).getTime()).toISOString()).toBe('2026-01-15T22:59:59.999Z');
    const springEnd = endOfLocalDay('2026-03-29', berlin);
    const fallEnd = endOfLocalDay('2026-10-25', berlin);
    expect(new Date(springEnd.getTime()).toISOString()).toBe('2026-03-29T21:59:59.999Z');
    expect(new Date(fallEnd.getTime()).toISOString()).toBe('2026-10-25T22:59:59.999Z');
    expect(springEnd.getTime() - new Date('2026-03-28T23:00:00.000Z').getTime()).toBe(23 * 60 * 60 * 1000 - 1);
    expect(fallEnd.getTime() - new Date('2026-10-24T22:00:00.000Z').getTime()).toBe(25 * 60 * 60 * 1000 - 1);
    expect(() => endOfLocalDay('2026-02-30', berlin)).toThrow(/Invalid calendar date/);
  });

  it('formats dates as DD/MM/YYYY and recent dates as Today, Yesterday, or a short date', () => {
    const now = new Date('2026-10-01T08:00:00.000Z');
    expect(formatDate(new Date('2026-09-30T23:30:00.000Z'), berlin)).toBe('01/10/2026');
    expect(formatDate('2026-09-30', berlin)).toBe('30/09/2026');
    expect(formatRecentDate('2026-10-01', now, berlin)).toBe('Today');
    expect(formatRecentDate('2026-09-30', now, berlin)).toBe('Yesterday');
    expect(formatRecentDate('2026-09-29', now, berlin)).toBe('29/09/2026');
    expect(() => formatDate('not-a-date', berlin)).toThrow(/YYYY-MM-DD/);
  });

  it('adds local calendar days over DST and compares ISO calendar dates', () => {
    expect(addLocalDays('2026-03-28', 1, berlin)).toBe('2026-03-29');
    expect(addLocalDays('2026-10-25', 1, berlin)).toBe('2026-10-26');
    expect(compareLocalDates('2026-02-28', '2026-03-01')).toBe(-1);
    expect(compareLocalDates('2026-03-01', '2026-03-01')).toBe(0);
    expect(compareLocalDates('2026-03-02', '2026-03-01')).toBe(1);
    expect(() => compareLocalDates('bad', '2026-01-01')).toThrow(/YYYY-MM-DD/);
    expect(() => compareLocalDates('2026-02-30', '2026-03-01')).toThrow(/Invalid calendar date/);
    expect(() => compareLocalDates('2026-03-01', '2026-02-30')).toThrow(/Invalid calendar date/);
  });
});

describe('local cadence slots', () => {
  it('clamps day 31 to each month end, including leap February, while retaining local keys', () => {
    const slots = getCadenceSlots(
      { kind: 'monthly', day: 31, time: '09:15' },
      new Date('2024-01-30T00:00:00.000Z'),
      new Date('2024-04-01T00:00:00.000Z'),
      berlin,
    );
    expect(slots.map(({ key }) => key)).toEqual([
      '2024-01-31T09:15',
      '2024-02-29T09:15',
      '2024-03-31T09:15',
    ]);
    expect(slots[0]?.instant.toISOString()).toBe('2024-01-31T08:15:00.000Z');
    expect(slots[2]?.instant.toISOString()).toBe('2024-03-31T07:15:00.000Z');
  });

  it('moves a nonexistent spring wall time to the first valid minute after the gap', () => {
    const slots = getCadenceSlots(
      { kind: 'monthly', day: 29, time: '02:30' },
      new Date('2026-03-29T00:00:00.000Z'),
      new Date('2026-03-29T23:00:00.000Z'),
      berlin,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ key: '2026-03-29T02:30' });
    expect(slots[0]?.instant.toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('runs a repeated fall wall time exactly once, choosing its earlier instant', () => {
    const slots = getCadenceSlots(
      { kind: 'monthly', day: 25, time: '02:30' },
      new Date('2026-10-25T00:00:00.000Z'),
      new Date('2026-10-25T23:00:00.000Z'),
      berlin,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ key: '2026-10-25T02:30' });
    expect(slots[0]?.instant.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('uses the anchor week for every-N-weeks cadence and includes range boundaries', () => {
    const slots = getCadenceSlots(
      { kind: 'weeks', every: 2, weekday: 1, anchorDate: '2026-01-05', time: '09:00' },
      new Date('2026-01-05T08:00:00.000Z'),
      new Date('2026-02-02T09:00:00.000Z'),
      berlin,
    );
    expect(slots.map(({ key }) => key)).toEqual([
      '2026-01-05T09:00',
      '2026-01-19T09:00',
      '2026-02-02T09:00',
    ]);
    expect(slots[0]?.instant.toISOString()).toBe('2026-01-05T08:00:00.000Z');
  });

  it('returns no slots for a reversed instant range and rejects invalid cadence settings', () => {
    const after = new Date('2026-01-10T00:00:00.000Z');
    const before = new Date('2026-01-01T00:00:00.000Z');
    expect(getCadenceSlots({ kind: 'monthly', day: 'last', time: '09:00' }, after, before, berlin)).toEqual([]);
    expect(() => getCadenceSlots({ kind: 'monthly', day: 32, time: '09:00' }, before, after, berlin)).toThrow(/Monthly cadence day/);
    expect(() => getCadenceSlots({ kind: 'weeks', every: 9, weekday: 1, anchorDate: '2026-01-05', time: '09:00' }, before, after, berlin)).toThrow(/Every-weeks cadence/);
    expect(() => getCadenceSlots({ kind: 'weeks', every: 1, weekday: 0, anchorDate: '2026-01-05', time: '09:00' }, before, after, berlin)).toThrow(/Weekday/);
    expect(() => getCadenceSlots({ kind: 'monthly', day: 'last', time: '25:00' }, before, after, berlin)).toThrow(/Invalid cadence time/);
  });
});
