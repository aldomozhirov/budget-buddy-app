import type Database from 'better-sqlite3';
import type { Clock } from '../clock.js';
import { defaultMaxAttempts, type Job, type JobSettings } from './types.js';

/** Where the runner reports failures that no job run owns. */
export interface JobLogger {
  error(error: unknown, message: string): void;
}

/** Options for `createJobRunner`. */
export interface JobRunnerOptions {
  database: Database.Database;
  clock: Clock;
  jobs: readonly Job[];
  logger?: JobLogger;
  /** Time between ticks; one minute unless a test says otherwise. */
  intervalMs?: number;
}

/** Wakes on a timer and runs the jobs whose slots are due, in the background. */
export interface JobRunner {
  /** Recovers interrupted runs, ticks at once, then ticks every interval. */
  start(): void;
  /** Stops the timer and waits for the runs still in flight. */
  stop(): Promise<void>;
  /**
   * Runs one pass over every job and resolves when the runs it started have
   * finished. Never rejects: failures are recorded in `job_run`.
   */
  tick(): Promise<void>;
}

/** The settings row as read with safe integers, so counts are bigints. */
type FamilyRow = Omit<
  JobSettings,
  'cadenceEveryWeeks' | 'cadenceWeekday' | 'followupDays'
> & {
  cadenceEveryWeeks: bigint | null;
  cadenceWeekday: bigint | null;
  followupDays: bigint;
};

const oneMinute = 60_000;
const maxErrorLength = 500;

/**
 * Creates the runner that claims each job's due slot in `job_run`, so a slot
 * runs once however many ticks overlap or restarts happen (COR-3). Only the
 * latest due slot of a job is run, a failed run is retried on later ticks up
 * to the job's limit, and one failing job never stops the others.
 */
export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const { database, clock, jobs, logger } = options;
  const intervalMs = options.intervalMs ?? oneMinute;
  const active = new Set<string>();
  const inFlight = new Set<Promise<void>>();
  let timer: NodeJS.Timeout | undefined;

  const selectSettings = database.prepare(
    `SELECT time_zone AS timeZone, common_currency AS commonCurrency,
      cadence_kind AS cadenceKind, cadence_day_of_month AS cadenceDayOfMonth,
      cadence_every_weeks AS cadenceEveryWeeks,
      cadence_weekday AS cadenceWeekday, cadence_time AS cadenceTime,
      cadence_anchor_date AS cadenceAnchorDate, followup_days AS followupDays
    FROM family WHERE id = 1`,
  );
  const selectLastDone = database.prepare(
    `SELECT MAX(slot) AS slot FROM job_run
    WHERE job = ? AND status = 'done'`,
  );
  const insertClaim = database.prepare(
    `INSERT INTO job_run (job, slot, status, attempts, started_at)
    VALUES (?, ?, 'running', 1, ?)
    ON CONFLICT (job, slot) DO NOTHING`,
  );
  const reclaimFailed = database.prepare(
    `UPDATE job_run SET status = 'running', attempts = attempts + 1,
      started_at = ?, finished_at = NULL, error = NULL
    WHERE job = ? AND slot = ? AND status = 'failed' AND attempts < ?`,
  );
  const finishRun = database.prepare(
    `UPDATE job_run SET status = ?, finished_at = ?, error = ?
    WHERE job = ? AND slot = ?`,
  );
  const failInterrupted = database.prepare(
    `UPDATE job_run SET status = 'failed', finished_at = ?, error = ?
    WHERE status = 'running'`,
  );

  /** Takes the slot for this process; false when it is done, running or spent. */
  function claim(job: Job, slot: string, startedAt: number): boolean {
    const claimed = database.transaction(() => {
      if (insertClaim.run(job.name, slot, startedAt).changes === 1) return true;
      const maxAttempts = job.maxAttempts ?? defaultMaxAttempts;
      return (
        reclaimFailed.run(startedAt, job.name, slot, maxAttempts).changes === 1
      );
    });
    return claimed();
  }

  /** Runs a claimed slot and records how it ended; never rejects. */
  async function execute(job: Job, slot: string): Promise<void> {
    let failure: string | null = null;
    try {
      await job.run(slot);
    } catch (error) {
      failure = describe(error);
      logger?.error(error, `Job ${job.name} failed for slot ${slot}`);
    }
    try {
      finishRun.run(
        failure === null ? 'done' : 'failed',
        clock.now().getTime(),
        failure,
        job.name,
        slot,
      );
    } catch (error) {
      logger?.error(error, `Job ${job.name} result for ${slot} not saved`);
    } finally {
      active.delete(job.name);
    }
  }

  /** Claims the latest due slot of a job, or returns undefined. */
  function claimDueSlot(
    job: Job,
    now: Date,
    settings: JobSettings,
  ): string | undefined {
    const lastDone = (selectLastDone.get(job.name) as { slot: string | null })
      .slot;
    const slot = job.dueSlots(now, settings, lastDone).at(-1);
    if (slot === undefined) return undefined;
    return claim(job, slot, now.getTime()) ? slot : undefined;
  }

  function tick(): Promise<void> {
    const runs: Promise<void>[] = [];
    try {
      const row = selectSettings.get() as FamilyRow | undefined;
      // Before first start there is no family, so no job has anything to do.
      if (!row) return Promise.resolve();
      const settings = toSettings(row);
      const now = clock.now();
      for (const job of jobs) {
        // One run of a job at a time, so a slow run is not started twice.
        if (active.has(job.name)) continue;
        try {
          const slot = claimDueSlot(job, now, settings);
          if (slot === undefined) continue;
          active.add(job.name);
          const run = execute(job, slot).finally(() => inFlight.delete(run));
          inFlight.add(run);
          runs.push(run);
        } catch (error) {
          logger?.error(error, `Job ${job.name} could not be scheduled`);
        }
      }
    } catch (error) {
      logger?.error(error, 'Job runner tick failed');
    }
    return Promise.all(runs).then(() => undefined);
  }

  return {
    start() {
      if (timer) return;
      try {
        // No run survives a restart, so anything still "running" was cut off.
        failInterrupted.run(clock.now().getTime(), 'Interrupted by a restart');
      } catch (error) {
        logger?.error(error, 'Job runner could not recover interrupted runs');
      }
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await Promise.all(inFlight);
    },
    tick,
  };
}

/** Turns the small counts in the row into plain numbers for jobs. */
function toSettings(row: FamilyRow): JobSettings {
  return {
    ...row,
    cadenceEveryWeeks: toNumber(row.cadenceEveryWeeks),
    cadenceWeekday: toNumber(row.cadenceWeekday),
    followupDays: Number(row.followupDays),
  };
}

function toNumber(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

/** Shortens an error to a message that fits the `job_run.error` column. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, maxErrorLength);
}
