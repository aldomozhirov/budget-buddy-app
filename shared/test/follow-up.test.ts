import { describe, expect, it } from 'vitest';
import {
  describeReminderIn,
  followUpSlot,
  followUpSlotsBetween,
  nextFollowUp,
} from '../src/time/index.js';

const berlin = 'Europe/Berlin';
const at = (iso: string) => new Date(iso);
/** A check-in a member opened at 13:00 in Berlin on 10 November 2026. */
const manual = {
  openedAt: Date.parse('2026-11-10T12:00:30Z'),
  scheduleSlot: null,
};
/** One the schedule opened for 09:00 on 5 December 2026. */
const scheduled = {
  openedAt: Date.parse('2026-12-05T08:00:10Z'),
  scheduleSlot: '2026-12-05T09:00',
};

describe('follow-up reminder times', () => {
  it('counts from the opening time of a check-in a member started', () => {
    const first = followUpSlot(manual, 2, 1, berlin);
    expect(first.key).toBe('2026-11-12T13:00');
    expect(first.instant.toISOString()).toBe('2026-11-12T12:00:00.000Z');
    expect(followUpSlot(manual, 2, 2, berlin).key).toBe('2026-11-14T13:00');
  });

  it('counts from the cadence time of a scheduled check-in', () => {
    const first = followUpSlot(scheduled, 3, 1, berlin);
    expect(first.key).toBe('2026-12-08T09:00');
    expect(first.instant.toISOString()).toBe('2026-12-08T08:00:00.000Z');
  });

  it('keeps the wall time across the end of daylight saving time', () => {
    // 09:00 on 24 October is CEST; 09:00 on 25 October is CET (25-hour day).
    const basis = {
      openedAt: Date.parse('2026-10-24T07:00:00Z'),
      scheduleSlot: '2026-10-24T09:00',
    };
    const first = followUpSlot(basis, 1, 1, berlin);
    expect(first.key).toBe('2026-10-25T09:00');
    expect(first.instant.toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  it('keeps the wall time across the start of daylight saving time', () => {
    const basis = {
      openedAt: Date.parse('2026-03-28T08:00:00Z'),
      scheduleSlot: '2026-03-28T09:00',
    };
    const first = followUpSlot(basis, 1, 1, berlin);
    expect(first.key).toBe('2026-03-29T09:00');
    expect(first.instant.toISOString()).toBe('2026-03-29T07:00:00.000Z');
  });

  it('moves a reminder in the spring gap to the first valid minute', () => {
    const basis = {
      openedAt: Date.parse('2026-03-28T01:30:00Z'),
      scheduleSlot: '2026-03-28T02:30',
    };
    const first = followUpSlot(basis, 1, 1, berlin);
    // 02:30 on 29 March does not exist in Berlin: the clock jumps to 03:00.
    expect(first.key).toBe('2026-03-29T02:30');
    expect(first.instant.toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('lists the reminders inside a range, oldest first', () => {
    const slots = followUpSlotsBetween(
      manual,
      2,
      at('2026-11-10T00:00:00Z'),
      at('2026-11-17T00:00:00Z'),
      berlin,
    );
    expect(slots.map(({ key }) => key)).toEqual([
      '2026-11-12T13:00',
      '2026-11-14T13:00',
      '2026-11-16T13:00',
    ]);
  });

  it('includes a reminder due exactly now and not one a minute away', () => {
    const due = followUpSlotsBetween(
      manual,
      2,
      at('2026-11-12T11:00:00Z'),
      at('2026-11-12T12:00:00Z'),
      berlin,
    );
    expect(due.map(({ key }) => key)).toEqual(['2026-11-12T13:00']);
    expect(
      followUpSlotsBetween(
        manual,
        2,
        at('2026-11-12T11:00:00Z'),
        at('2026-11-12T11:59:00Z'),
        berlin,
      ),
    ).toEqual([]);
  });

  it('gives none when reminders are off', () => {
    expect(
      followUpSlotsBetween(
        manual,
        0,
        at('2026-11-10T00:00:00Z'),
        at('2026-12-10T00:00:00Z'),
        berlin,
      ),
    ).toEqual([]);
    expect(nextFollowUp(manual, 0, at('2026-11-10T13:00:00Z'), berlin)).toBe(
      null,
    );
  });

  it('never reminds at or before the moment a made-up check-in opened', () => {
    // The slot was 1 December at 09:00; the server only opened it on the 4th.
    const madeUp = {
      openedAt: Date.parse('2026-12-04T10:00:00Z'),
      scheduleSlot: '2026-12-01T09:00',
    };
    const slots = followUpSlotsBetween(
      madeUp,
      2,
      at('2026-12-04T10:00:00Z'),
      at('2026-12-04T10:05:00Z'),
      berlin,
    );
    expect(slots).toEqual([]);
    expect(
      nextFollowUp(madeUp, 2, at('2026-12-04T10:00:00Z'), berlin)?.key,
    ).toBe('2026-12-05T09:00');
  });

  it('finds the next reminder after a moment', () => {
    expect(
      nextFollowUp(manual, 2, at('2026-11-10T12:01:00Z'), berlin)?.key,
    ).toBe('2026-11-12T13:00');
    // At the reminder itself the next one is a whole interval away.
    expect(
      nextFollowUp(manual, 2, at('2026-11-12T12:00:00Z'), berlin)?.key,
    ).toBe('2026-11-14T13:00');
    expect(
      nextFollowUp(manual, 2, at('2026-12-31T12:00:00Z'), berlin)?.key,
    ).toBe('2027-01-01T13:00');
  });

  it('words how far off a reminder is by calendar days in the zone', () => {
    const now = at('2026-11-10T22:30:00Z'); // 23:30 in Berlin
    expect(describeReminderIn(at('2026-11-10T22:45:00Z'), now, berlin)).toBe(
      'today',
    );
    // 00:30 in Berlin the next day: one calendar day, though only an hour.
    expect(describeReminderIn(at('2026-11-10T23:30:00Z'), now, berlin)).toBe(
      'tomorrow',
    );
    expect(describeReminderIn(at('2026-11-12T12:00:00Z'), now, berlin)).toBe(
      'in 2 days',
    );
    expect(describeReminderIn(at('2026-11-17T12:00:00Z'), now, berlin)).toBe(
      'in 7 days',
    );
  });
});
