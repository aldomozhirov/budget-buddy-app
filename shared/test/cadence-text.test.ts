import { describe, expect, it } from 'vitest';
import {
  describeCadence,
  formatSlotDay,
  formatSlotTime,
  nextCadenceSlot,
  summarizeCadence,
  type CadenceSetting,
} from '../src/index.js';

const berlin = 'Europe/Berlin';

describe('cadence in words', () => {
  const cases: Array<[CadenceSetting, string, string]> = [
    [{ kind: 'off' }, 'Schedule off', 'Off'],
    [
      { kind: 'monthly', day: 5, time: '09:00' },
      'Monthly on the 5th, 09:00',
      'Monthly, 5th, 09:00',
    ],
    [
      { kind: 'monthly', day: 1, time: '08:00' },
      'Monthly on the 1st, 08:00',
      'Monthly, 1st, 08:00',
    ],
    [
      { kind: 'monthly', day: 22, time: '19:00' },
      'Monthly on the 22nd, 19:00',
      'Monthly, 22nd, 19:00',
    ],
    [
      { kind: 'monthly', day: 13, time: '12:00' },
      'Monthly on the 13th, 12:00',
      'Monthly, 13th, 12:00',
    ],
    [
      { kind: 'monthly', day: 'last', time: '09:00' },
      'Monthly on the last day, 09:00',
      'Monthly, last day, 09:00',
    ],
    [
      { kind: 'weeks', every: 2, weekday: 5, time: '09:00' },
      'Every 2 weeks on Friday, 09:00',
      'Every 2 weeks, Fri, 09:00',
    ],
    [
      { kind: 'weeks', every: 1, weekday: 7, time: '19:00' },
      'Every week on Sunday, 19:00',
      'Every week, Sun, 19:00',
    ],
  ];

  it.each(cases)('describes %j', (setting, header, row) => {
    expect(describeCadence(setting)).toBe(header);
    expect(summarizeCadence(setting)).toBe(row);
  });

  it('formats a slot key as a day and a time', () => {
    expect(formatSlotDay('2026-11-05T09:00')).toBe('5 November');
    expect(formatSlotDay('2027-02-28T09:00')).toBe('28 February');
    expect(formatSlotTime('2026-11-05T09:00')).toBe('09:00');
  });
});

describe('next cadence slot', () => {
  it('is the first slot strictly after now', () => {
    const monthly: CadenceSetting = { kind: 'monthly', day: 5, time: '09:00' };
    const next = (iso: string) =>
      nextCadenceSlot(monthly, '2026-10-01', new Date(iso), berlin)?.key;
    expect(next('2026-10-11T10:00:00Z')).toBe('2026-11-05T09:00');
    // 09:00 Berlin on 5 November is 08:00Z; at that instant the slot is past.
    expect(next('2026-11-05T07:59:00Z')).toBe('2026-11-05T09:00');
    expect(next('2026-11-05T08:00:00Z')).toBe('2026-12-05T09:00');
  });

  it('is undefined while the cadence is off', () => {
    expect(
      nextCadenceSlot({ kind: 'off' }, '2026-10-01', new Date(), berlin),
    ).toBeUndefined();
  });

  it('finds an eight-week slot and the last day of February', () => {
    expect(
      nextCadenceSlot(
        { kind: 'weeks', every: 8, weekday: 1, time: '09:00' },
        '2026-10-12',
        new Date('2026-10-12T10:00:00Z'),
        berlin,
      )?.key,
    ).toBe('2026-12-07T09:00');
    expect(
      nextCadenceSlot(
        { kind: 'monthly', day: 'last', time: '09:00' },
        '2027-02-01',
        new Date('2027-02-01T10:00:00Z'),
        berlin,
      )?.key,
    ).toBe('2027-02-28T09:00');
  });
});
