import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const minorStringSchema = z.string().regex(/^-?\d{1,19}$/u);

/** The open check-in as Home's banner shows it: names and counts, no money. */
export const homeCheckinSchema = z.object({
  id: z.number().int().positive(),
  /** True when the schedule opened it, false when a member started it. */
  scheduled: z.boolean(),
  /** The schedule's rhythm when it has a plain name, for "Monthly check-in". */
  cadence: z.enum(['monthly', 'weekly']).nullable(),
  /** The member who started it; null when the schedule opened it. */
  openedBy: z.string().nullable(),
  /** True when the signed-in profile started it, so Home can say "You". */
  openedByYou: z.boolean(),
  /** The day it opened, YYYY-MM-DD in the family's time zone. */
  openedDate: dateSchema,
  /** Accounts of the signed-in profile that still need a value. */
  accountsLeft: z.number().int().nonnegative(),
});

/** Current wealth against the latest closed check-in (DSH-1, O2). */
export const homeWealthSchema = z.object({
  /** The latest closed check-in, which the wealth card opens. */
  checkinId: z.number().int().positive(),
  /** Latest balances at the latest rates; null when a rate is missing. */
  amount: minorStringSchema.nullable(),
  /** The latest closed check-in's date, YYYY-MM-DD. */
  lastCheckinDate: dateSchema,
  /** `amount` minus that check-in's equivalent; null when either is null. */
  change: minorStringSchema.nullable(),
});

/** One active envelope on Home's card (DSH-4). */
export const homeEnvelopeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  currency: z.string(),
  /** What the month had to spend: opening, top-up and adjustments. */
  available: minorStringSchema,
  /** Spent this month, in the envelope's currency. */
  spent: minorStringSchema,
  /** The balance now (`available − spent`); negative when overspent. */
  left: minorStringSchema,
  /**
   * Whole percent of `available` spent, rounded down so 100 means all of
   * it, and 100 when `over`. This is what shows while amounts are hidden.
   */
  share: z.number().int().min(0).max(100),
  /** The balance is below zero. */
  over: z.boolean(),
});

/** An envelope as Home's card shows it. */
export type HomeEnvelope = z.infer<typeof homeEnvelopeSchema>;

/** This month's spending: the envelopes card (DSH-4, UI-HOME-1). */
export const homeSpendingSchema = z.object({
  /** Spent this month in the common currency, as Transactions sums it. */
  spent: minorStringSchema.nullable(),
  /** Active envelopes in their order; never empty. */
  envelopes: z.array(homeEnvelopeSchema).min(1),
});

/** What the Home screen needs in one call (DSH-1, NTF-1, BKP-4). */
export const homeResponseSchema = z.object({
  /** Today in the family's time zone, YYYY-MM-DD. */
  today: dateSchema,
  commonCurrency: z.string(),
  /** The device's "Hide amounts on Home" setting (UI-HOME-4). */
  hideAmounts: z.boolean(),
  checkin: homeCheckinSchema.nullable(),
  /** Null while no check-in has been closed. */
  wealth: homeWealthSchema.nullable(),
  /** Null without active envelopes, which hides the card. */
  spending: homeSpendingSchema.nullable(),
  /** Transactions waiting for a category (CAT-7); 0 hides the row. */
  needsCategory: z.number().int().nonnegative(),
  /** Set when the last successful backup is over two days old. */
  backupWarning: z.object({ daysAgo: z.number().int().min(2) }).nullable(),
});

/** Response of `GET /api/home`. */
export type HomeResponse = z.infer<typeof homeResponseSchema>;

/** This browser's own settings (UI-HOME-4). */
export const deviceSettingsSchema = z.object({
  hideHomeAmounts: z.boolean(),
});

/** Response of `GET` and `PATCH /api/devices/current`. */
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;

/** Validates a change to this device's settings. */
export const updateDeviceRequestSchema = z
  .object({ hideHomeAmounts: z.boolean() })
  .strict();
