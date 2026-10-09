import { z } from 'zod';

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/u, 'Choose a currency from the list.');

/** Family-wide currency and time zone settings. */
export const settingsResponseSchema = z.object({
  commonCurrency: currencyCodeSchema,
  timeZone: z.string().min(1),
});

/** Settings returned by `GET /api/settings`. */
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

/** Validates updates to family-wide currency and time zone settings. */
export const updateSettingsRequestSchema = z
  .object({
    commonCurrency: currencyCodeSchema.optional(),
    timeZone: z.string().trim().min(1, 'Choose a time zone.').optional(),
  })
  .strict()
  .refine(
    (settings) =>
      settings.commonCurrency !== undefined || settings.timeZone !== undefined,
    'Change at least one setting.',
  );
