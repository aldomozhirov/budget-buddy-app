import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createCheckinEventBus, type CheckinEvents } from '../src/events.js';
import { createCheckinScheduleJob } from '../src/jobs/checkinSchedule.js';
import { createJobRunner } from '../src/jobs/runner.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };

type CheckinRow = {
  id: bigint;
  opened_by: bigint | null;
  schedule_slot: string | null;
  opened_at: bigint;
};

describe('check-in schedule job', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let cookies: string;
  let now: number;
  let opened: CheckinEvents['checkin.opened'][];
  const clock = { now: () => new Date(now) };
  let events: ReturnType<typeof createCheckinEventBus>;

  /** A fresh runner, as after a server restart. */
  const tick = () =>
    createJobRunner({
      database,
      clock,
      jobs: [createCheckinScheduleJob({ database, clock, events })],
    }).tick();
  const at = (iso: string) => {
    now = Date.parse(iso);
  };
  const checkins = () =>
    database
      .prepare(
        'SELECT id, opened_by, schedule_slot, opened_at FROM checkin ORDER BY id',
      )
      .all() as CheckinRow[];
  const patch = (payload: unknown) =>
    app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: payload as object,
    });
  const setCadence = async (cadence: unknown) => {
    const response = await patch({ cadence });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  const closeAll = () =>
    database
      .prepare('UPDATE checkin SET closed_at = ? WHERE closed_at IS NULL')
      .run(now);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-schedule-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    at('2026-11-10T12:00:00Z');
    events = createCheckinEventBus();
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock,
      events,
    });
    await migrateDatabase(database, { backupDir: directory, migrationsFolder });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'ScheduleTest/1.0' },
      payload: {
        password: 'correct horse battery staple',
        passwordConfirmation: 'correct horse battery staple',
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(setup.statusCode).toBe(201);
    const header = setup.headers['set-cookie'];
    cookies = (Array.isArray(header) ? header : [header])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.split(';', 1)[0])
      .join('; ');
    opened = [];
    events.on('checkin.opened', (event) => {
      opened.push(event);
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('runs a "Last day" slot on the last day of a 30-day month', async () => {
    await setCadence({ kind: 'monthly', day: 'last', time: '09:00' });

    at('2026-11-29T08:00:00Z');
    await tick();
    at('2026-11-30T07:59:00Z');
    await tick();
    expect(checkins()).toEqual([]);

    // 09:00 in Berlin is 08:00 UTC in November.
    at('2026-11-30T08:00:00Z');
    await tick();
    expect(checkins()).toEqual([
      expect.objectContaining({ schedule_slot: '2026-11-30T09:00' }),
    ]);
  });

  it('runs a "Last day" slot on 28 February in a common year', async () => {
    at('2027-01-20T12:00:00Z');
    await setCadence({ kind: 'monthly', day: 'last', time: '09:00' });

    at('2027-01-31T08:00:00Z');
    await tick();
    closeAll();
    at('2027-02-27T12:00:00Z');
    await tick();
    expect(checkins()).toHaveLength(1);
    at('2027-02-28T08:00:00Z');
    await tick();
    expect(checkins().map((row) => row.schedule_slot)).toEqual([
      '2027-01-31T09:00',
      '2027-02-28T09:00',
    ]);
  });

  it('opens the check-in by schedule and emits checkin.opened', async () => {
    await setCadence({ kind: 'monthly', day: 5, time: '09:00' });
    at('2026-12-05T08:00:00Z');

    await tick();

    const [row] = checkins();
    expect(row).toMatchObject({
      opened_by: null,
      schedule_slot: '2026-12-05T09:00',
      opened_at: BigInt(now),
    });
    expect(opened).toEqual([
      {
        checkinId: Number(row?.id),
        openedAt: now,
        openedBy: null,
        scheduleSlot: '2026-12-05T09:00',
      },
    ]);
  });

  it('opens one check-in, not two, after the server was off across slots', async () => {
    await setCadence({ kind: 'weeks', every: 1, weekday: 5, time: '09:00' });
    // Fridays: 13, 20 and 27 November all passed while the server was off.
    at('2026-11-28T10:00:00Z');

    await tick();
    await tick();
    at('2026-11-28T10:05:00Z');
    await tick();

    expect(checkins().map((row) => row.schedule_slot)).toEqual([
      '2026-11-27T09:00',
    ]);
    expect(opened).toHaveLength(1);
  });

  it('does not open the same slot again once its check-in is closed', async () => {
    await setCadence({ kind: 'monthly', day: 5, time: '09:00' });
    at('2026-12-05T08:00:00Z');
    await tick();
    closeAll();

    at('2026-12-05T09:00:00Z');
    await tick();

    expect(checkins()).toHaveLength(1);
    expect(opened).toHaveLength(1);
  });

  it('opens nothing when a check-in is already open at the slot', async () => {
    await setCadence({ kind: 'monthly', day: 5, time: '09:00' });
    const started = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: {},
    });
    expect(started.statusCode).toBe(201);
    opened = [];

    at('2026-12-05T08:00:00Z');
    await tick();

    expect(checkins()).toEqual([
      expect.objectContaining({ opened_by: 1n, schedule_slot: null }),
    ]);
    expect(opened).toEqual([]);
    const run = database
      .prepare("SELECT status FROM job_run WHERE slot = '2026-12-05T09:00'")
      .get();
    expect(run).toEqual({ status: 'done' });
  });

  it('moves the next slot when the cadence changes, without opening one', async () => {
    const first = await setCadence({ kind: 'monthly', day: 5, time: '09:00' });
    expect(first.nextSlot).toBe('2026-12-05T09:00');

    // The 3rd of this month already passed: it must not run now.
    const moved = await setCadence({ kind: 'monthly', day: 3, time: '09:00' });
    expect(moved.nextSlot).toBe('2026-12-03T09:00');
    await tick();
    expect(checkins()).toEqual([]);

    // Today is Tuesday 10 November, 13:00 Berlin: Tuesday 09:00 has passed.
    const weekly = await setCadence({
      kind: 'weeks',
      every: 2,
      weekday: 2,
      time: '09:00',
    });
    expect(weekly.nextSlot).toBe('2026-11-24T09:00');
    await tick();
    expect(checkins()).toEqual([]);

    at('2026-11-24T08:00:00Z');
    await tick();
    expect(checkins().map((row) => row.schedule_slot)).toEqual([
      '2026-11-24T09:00',
    ]);
  });

  it('opens nothing and reports no next slot while the cadence is off', async () => {
    await setCadence({ kind: 'monthly', day: 5, time: '09:00' });
    const off = await setCadence({ kind: 'off' });
    expect(off).toMatchObject({ cadence: { kind: 'off' }, nextSlot: null });

    at('2026-12-06T08:00:00Z');
    await tick();
    expect(checkins()).toEqual([]);
  });

  it('keeps a changed cadence from replaying the slots it skipped while off', async () => {
    await setCadence({ kind: 'off' });
    at('2026-12-20T10:00:00Z');
    // Turned on after the 5th of December had passed.
    await setCadence({ kind: 'monthly', day: 5, time: '09:00' });
    await tick();
    expect(checkins()).toEqual([]);
  });

  it('runs a time that does not exist (spring forward) once, at 03:00', async () => {
    at('2026-03-27T12:00:00Z');
    // 29 March 2026 is a Sunday: 02:30 does not exist in Berlin, where the
    // clocks jump from 02:00 to 03:00.
    await setCadence({ kind: 'weeks', every: 1, weekday: 7, time: '02:30' });

    at('2026-03-29T00:59:00Z');
    await tick();
    expect(checkins()).toEqual([]);
    at('2026-03-29T01:00:00Z');
    await tick();
    at('2026-03-29T01:30:00Z');
    await tick();
    expect(checkins().map((row) => row.schedule_slot)).toEqual([
      '2026-03-29T02:30',
    ]);
  });

  it('runs a time that exists twice (fall back) once', async () => {
    at('2026-10-20T12:00:00Z');
    await setCadence({ kind: 'weeks', every: 1, weekday: 7, time: '02:30' });

    // 25 October 2026: 02:30 happens at 00:30Z and again at 01:30Z.
    at('2026-10-25T00:30:00Z');
    await tick();
    closeAll();
    at('2026-10-25T01:30:00Z');
    await tick();

    expect(checkins().map((row) => row.schedule_slot)).toEqual([
      '2026-10-25T02:30',
    ]);
  });

  describe('a time-zone change', () => {
    const monthly = { kind: 'monthly', day: 11, time: '19:00' } as const;

    // 11 November, 12:00Z: 13:00 in Berlin, 21:00 in Tokyo.
    it.each([
      ['alone', (zone: string) => ({ timeZone: zone })],
      [
        'with the same cadence in the body',
        (zone: string) => ({ timeZone: zone, cadence: monthly }),
      ],
    ])('settles the slots up to now, %s', async (_name, body) => {
      at('2026-11-11T08:00:00Z');
      await setCadence(monthly);
      // 19:00 on the 11th is still ahead in Berlin; it is already past in Tokyo.
      at('2026-11-11T12:00:00Z');

      const response = await patch(body('Asia/Tokyo'));
      expect(response.statusCode).toBe(200);
      await tick();

      expect(checkins()).toEqual([]);
      expect(response.json().nextSlot).toBe('2026-12-11T19:00');
    });

    it('settles when the cadence in the same request changes too', async () => {
      at('2026-11-11T08:00:00Z');
      await setCadence(monthly);
      at('2026-11-11T12:00:00Z');

      await patch({
        timeZone: 'Asia/Tokyo',
        cadence: { kind: 'monthly', day: 11, time: '20:00' },
      });
      await tick();

      expect(checkins()).toEqual([]);
    });

    it('leaves slots alone when the zone stays the same', async () => {
      at('2026-11-11T08:00:00Z');
      await setCadence(monthly);
      at('2026-11-11T12:00:00Z');

      await patch({ timeZone: 'Europe/Berlin', cadence: monthly });
      at('2026-11-11T18:00:00Z');
      await tick();

      expect(checkins().map((row) => row.schedule_slot)).toEqual([
        '2026-11-11T19:00',
      ]);
    });
  });

  describe('settings API', () => {
    it('returns the cadence and next slot, and starts off', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { cookie: cookies },
      });
      expect(response.json()).toMatchObject({
        cadence: { kind: 'off' },
        nextSlot: null,
      });
    });

    it('stores a weekly cadence and counts the weeks from today', async () => {
      const body = await setCadence({
        kind: 'weeks',
        every: 3,
        weekday: 2,
        time: '19:00',
      });
      expect(body.cadence).toEqual({
        kind: 'weeks',
        every: 3,
        weekday: 2,
        time: '19:00',
      });
      // Today is Tuesday 10 November 13:00 Berlin; 19:00 is still ahead.
      expect(body.nextSlot).toBe('2026-11-10T19:00');
      expect(
        database.prepare('SELECT cadence_anchor_date AS a FROM family').get(),
      ).toEqual({ a: '2026-11-10' });
    });

    it('rejects a day above 28, a bad time and a missing time', async () => {
      for (const cadence of [
        { kind: 'monthly', day: 29, time: '09:00' },
        { kind: 'monthly', day: 5, time: '25:00' },
        { kind: 'monthly', day: 5 },
        { kind: 'weeks', every: 9, weekday: 1, time: '09:00' },
        { kind: 'weeks', every: 2, weekday: 8, time: '09:00' },
      ]) {
        expect((await patch({ cadence })).statusCode).toBe(400);
      }
    });

    it('leaves the anchor alone when the same cadence is saved again', async () => {
      const weekly = { kind: 'weeks', every: 2, weekday: 5, time: '09:00' };
      await setCadence(weekly);
      at('2026-11-12T12:00:00Z');
      await setCadence(weekly);
      expect(
        database.prepare('SELECT cadence_anchor_date AS a FROM family').get(),
      ).toEqual({ a: '2026-11-10' });
    });
  });
});
