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
