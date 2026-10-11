import { z } from 'zod';
import { cadenceSettingSchema } from './schedule.js';

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/u, 'Choose a currency from the list.');

/** Days between follow-up reminders (CHK-3): 0 turns them off, 30 at most. */
export const followupDaysSchema = z.number().int().min(0).max(30);

/** Family-wide currency, time zone, check-in cadence and reminder settings. */
export const settingsResponseSchema = z.object({
  commonCurrency: currencyCodeSchema,
  timeZone: z.string().min(1),
  /** The check-in cadence (CHK-2). */
  cadence: cadenceSettingSchema,
  /**
   * Local `YYYY-MM-DDTHH:MM` of the next scheduled check-in, or null when the
   * cadence is off.
   */
  nextSlot: z.string().nullable(),
  /** Days between follow-up reminders while a check-in is open; 0 is off. */
  followupDays: followupDaysSchema,
});

/** Settings returned by `GET /api/settings`. */
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

/** Validates updates to the family-wide settings; send only what changes. */
export const updateSettingsRequestSchema = z
  .object({
    commonCurrency: currencyCodeSchema.optional(),
    timeZone: z.string().trim().min(1, 'Choose a time zone.').optional(),
    cadence: cadenceSettingSchema.optional(),
    followupDays: followupDaysSchema.optional(),
  })
  .strict()
  .refine(
    (settings) =>
      settings.commonCurrency !== undefined ||
      settings.timeZone !== undefined ||
      settings.cadence !== undefined ||
      settings.followupDays !== undefined,
    'Change at least one setting.',
  );
