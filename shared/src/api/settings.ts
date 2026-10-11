import { z } from 'zod';
import { cadenceSettingSchema } from './schedule.js';

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/u, 'Choose a currency from the list.');

/** Family-wide currency, time zone and check-in cadence settings. */
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
});

/** Settings returned by `GET /api/settings`. */
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

/** Validates updates to family-wide currency and time zone settings. */
export const updateSettingsRequestSchema = z
  .object({
    commonCurrency: currencyCodeSchema.optional(),
    timeZone: z.string().trim().min(1, 'Choose a time zone.').optional(),
    cadence: cadenceSettingSchema.optional(),
  })
  .strict()
  .refine(
    (settings) =>
      settings.commonCurrency !== undefined ||
      settings.timeZone !== undefined ||
      settings.cadence !== undefined,
    'Change at least one setting.',
  );
