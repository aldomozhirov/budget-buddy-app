import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateDatabase } from '../src/db/migrate.js';
import { createJobRunner, type JobRunner } from '../src/jobs/runner.js';
import type { Job } from '../src/jobs/types.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const minute = 60_000;
const day = 24 * 60 * minute;
const start = Date.parse('2026-10-10T08:00:00.000Z');

type RunRow = {
  job: string;
  slot: string;
  status: string;
  attempts: bigint;
  error: string | null;
  finished_at: bigint | null;
};

/** Slots are the UTC dates at `hour`; those up to `now` and past the last done. */
function dailyJob(
  name: string,
  run: Job['run'],
  extra: Partial<Job> = {},
): Job {
  return {
    name,
    run,
    dueSlots(now, _settings, lastDoneSlot) {
      const slots: string[] = [];
      for (let offset = 5; offset >= 0; offset -= 1) {
        const date = new Date(now.getTime() - offset * day)
          .toISOString()
          .slice(0, 10);
        if (Date.parse(`${date}T06:00:00.000Z`) > now.getTime()) continue;
        if (lastDoneSlot === null || date > lastDoneSlot) slots.push(date);
      }
      return slots;
    },
    ...extra,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('job runner', () => {
  let database: Database.Database;
  let directory: string;
  let now: number;
  const clock = { now: () => new Date(now) };
  const errors: unknown[] = [];

  const runner = (jobs: Job[]): JobRunner =>
    createJobRunner({
      database,
      clock,
      jobs,
      logger: { error: (error) => errors.push(error) },
    });
  const rows = () =>
    database
      .prepare(
        'SELECT job, slot, status, attempts, error, finished_at FROM job_run ORDER BY job, slot',
      )
      .all() as RunRow[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-jobs-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, { backupDir: directory, migrationsFolder });
    database
      .prepare(
        "INSERT INTO family (id, password_hash, created_at) VALUES (1, 'x', 1)",
      )
      .run();
    now = start;
    errors.length = 0;
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('runs the due slot and records the result', async () => {
    const run = vi.fn();
    const job = dailyJob('daily', run);

    await runner([job]).tick();
    await runner([job]).tick();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('2026-10-10');
    expect(rows()).toEqual([
      expect.objectContaining({
        job: 'daily',
        slot: '2026-10-10',
        status: 'done',
        attempts: 1n,
        error: null,
        finished_at: BigInt(start),
      }),
    ]);
  });

  it('passes the family settings and the last done slot to dueSlots', async () => {
    const dueSlots = vi.fn(() => []);
    database
      .prepare(
        "INSERT INTO job_run (job, slot, status, started_at) VALUES ('daily', '2026-10-08', 'done', 1), ('daily', '2026-10-09', 'failed', 1)",
      )
      .run();

    await runner([{ name: 'daily', dueSlots, run: vi.fn() }]).tick();

    expect(dueSlots).toHaveBeenCalledWith(
      new Date(start),
      expect.objectContaining({
        timeZone: 'Europe/Berlin',
        commonCurrency: 'EUR',
        cadenceKind: 'off',
        followupDays: 2,
      }),
      '2026-10-08',
    );
  });

  it('does nothing before the family exists', async () => {
    database.prepare('DELETE FROM family').run();
    const run = vi.fn();

    await runner([dailyJob('daily', run)]).tick();

    expect(run).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  it('runs a slot once when two ticks overlap', async () => {
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const instance = runner([dailyJob('daily', run)]);

    const first = instance.tick();
    const second = instance.tick();
    expect(rows()).toEqual([expect.objectContaining({ status: 'running' })]);
    gate.resolve();
    await Promise.all([first, second]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual([expect.objectContaining({ status: 'done' })]);
  });

  it('runs a slot once across two runner instances on one database', async () => {
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const first = runner([dailyJob('daily', run)]).tick();
    const second = runner([dailyJob('daily', run)]).tick();
    gate.resolve();
    await Promise.all([first, second]);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not start a job again while its earlier run is still going', async () => {
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const instance = runner([dailyJob('daily', run)]);

    const first = instance.tick();
    now += day;
    await instance.tick();
    expect(run).toHaveBeenCalledTimes(1);
    gate.resolve();
    await first;
    await instance.tick();

    expect(run.mock.calls).toEqual([['2026-10-10'], ['2026-10-11']]);
  });

  it('makes up only the latest slot after downtime across two slots', async () => {
    const run = vi.fn();
    const job = dailyJob('daily', run);
    await runner([job]).tick();
    run.mockClear();

    // The server is off for the 11th and 12th and starts on the 12th at noon.
    now = Date.parse('2026-10-12T12:00:00.000Z');
    await runner([job]).tick();

    expect(run.mock.calls).toEqual([['2026-10-12']]);
    expect(rows().map((row) => row.slot)).toEqual(['2026-10-10', '2026-10-12']);
  });

  it('retries a failed run at the next tick up to the job limit', async () => {
    const run = vi.fn(() => {
      throw new Error('feed is down');
    });
    const instance = runner([dailyJob('daily', run, { maxAttempts: 3 })]);

    for (let tick = 0; tick < 5; tick += 1) {
      now += minute;
      await instance.tick();
    }

    expect(run).toHaveBeenCalledTimes(3);
    expect(rows()).toEqual([
      expect.objectContaining({
        slot: '2026-10-10',
        status: 'failed',
        attempts: 3n,
        error: 'feed is down',
      }),
    ]);
    expect(errors).toHaveLength(3);
  });

  it('waits for the next slot once the limit is spent, then runs it', async () => {
    const run = vi.fn((slot: string) => {
      if (slot === '2026-10-10') throw new Error('feed is down');
    });
    const instance = runner([dailyJob('daily', run, { maxAttempts: 2 })]);
    for (let tick = 0; tick < 3; tick += 1) await instance.tick();
    expect(run).toHaveBeenCalledTimes(2);

    now += day;
    await instance.tick();

    expect(run).toHaveBeenLastCalledWith('2026-10-11');
    expect(rows().map((row) => [row.slot, row.status, row.attempts])).toEqual([
      ['2026-10-10', 'failed', 2n],
      ['2026-10-11', 'done', 1n],
    ]);
  });

  it('stops retrying after a retry succeeds', async () => {
    let calls = 0;
    const run = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error('once');
    });
    const instance = runner([dailyJob('daily', run)]);

    for (let tick = 0; tick < 3; tick += 1) await instance.tick();

    expect(run).toHaveBeenCalledTimes(2);
    expect(rows()).toEqual([
      expect.objectContaining({ status: 'done', attempts: 2n, error: null }),
    ]);
  });

  it('keeps the other jobs running when one fails or cannot be scheduled', async () => {
    const good = vi.fn();
    const rejecting = vi.fn(() => Promise.reject(new Error('rejected')));
    const broken: Job = {
      name: 'broken',
      run: vi.fn(),
      dueSlots() {
        throw new Error('bad schedule');
      },
    };

    await runner([
      dailyJob('first', rejecting),
      broken,
      dailyJob('last', good),
    ]).tick();

    expect(good).toHaveBeenCalledWith('2026-10-10');
    expect(rows().map((row) => [row.job, row.status])).toEqual([
      ['first', 'failed'],
      ['last', 'done'],
    ]);
    expect(errors).toHaveLength(2);
  });

  it('does not rerun a done slot even if the job lists it again', async () => {
    const run = vi.fn();
    const stubborn: Job = {
      name: 'stubborn',
      run,
      dueSlots: () => ['2026-10-10'],
    };
    const instance = runner([stubborn]);

    await instance.tick();
    await instance.tick();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ticks at start and every minute, and fails runs a restart cut off', async () => {
    vi.useFakeTimers();
    database
      .prepare(
        "INSERT INTO job_run (job, slot, status, started_at) VALUES ('daily', '2026-10-10', 'running', 1)",
      )
      .run();
    const run = vi.fn();
    const dueSlots = vi.fn(() => [] as string[]);
    const instance = runner([{ name: 'ticking', dueSlots, run }]);

    instance.start();
    expect(dueSlots).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({
      status: 'failed',
      error: 'Interrupted by a restart',
      finished_at: BigInt(start),
    });
    await vi.advanceTimersByTimeAsync(3 * minute);
    expect(dueSlots).toHaveBeenCalledTimes(4);
    await instance.stop();
    await vi.advanceTimersByTimeAsync(3 * minute);
    expect(dueSlots).toHaveBeenCalledTimes(4);
  });

  it('waits for runs in flight when stopped', async () => {
    const gate = deferred();
    const instance = runner([dailyJob('daily', () => gate.promise)]);
    void instance.tick();

    let stopped = false;
    const stopping = instance.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    gate.resolve();
    await stopping;

    expect(rows()).toEqual([expect.objectContaining({ status: 'done' })]);
  });
});
