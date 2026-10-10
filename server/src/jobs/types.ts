/** Family settings a job may depend on, read fresh on every runner tick. */
export interface JobSettings {
  /** IANA time zone that governs "today", schedules and day ends (DEP-9). */
  timeZone: string;
  commonCurrency: string;
  cadenceKind: 'off' | 'monthly' | 'weeks';
  /** 1-28 or `'last'`; set only for a monthly cadence. */
  cadenceDayOfMonth: string | null;
  cadenceEveryWeeks: number | null;
  /** ISO weekday, 1 = Monday to 7 = Sunday. */
  cadenceWeekday: number | null;
  /** Local wall time, `HH:MM`. */
  cadenceTime: string | null;
  /** `YYYY-MM-DD` from which "every N weeks" is counted. */
  cadenceAnchorDate: string | null;
  /** Days before a follow-up reminder; 0 turns reminders off. */
  followupDays: number;
}

/** Attempts a slot gets, counting the first, when a job sets no limit. */
export const defaultMaxAttempts = 3;

/** A scheduled unit of work that the runner can claim, run and retry. */
export interface Job {
  /** Stable name; with a slot it identifies one run in `job_run`. */
  name: string;
  /**
   * Total tries per slot, including the first. After this many failures the
   * slot is left alone until the next slot is due. Defaults to
   * `defaultMaxAttempts`.
   */
  maxAttempts?: number;
  /**
   * Lists the slots that are due at `now` and have not been done yet, oldest
   * first. Slot keys must sort chronologically as plain strings, and
   * `lastDoneSlot` (the greatest done key, or null) lets the job skip every
   * slot up to it. The runner runs only the last slot it returns, so a
   * server that was off across several slots makes up the latest one.
   */
  dueSlots(
    now: Date,
    settings: JobSettings,
    lastDoneSlot: string | null,
  ): string[];
  /**
   * Does the work of one slot. A thrown error or rejection marks the run
   * failed; the work should be safe to repeat because a retry runs it again.
   */
  run(slot: string): void | Promise<void>;
}
