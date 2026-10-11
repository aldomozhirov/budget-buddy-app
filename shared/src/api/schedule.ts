import { z } from 'zod';

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Choose a time of day.');

/**
 * The family's check-in cadence as the schedule sheet edits it (CHK-2).
 * - `off`: no check-in opens by itself.
 * - `monthly`: on `day` 1-28 or the `'last'` day of each month.
 * - `weeks`: every `every` weeks (1-8) on ISO `weekday` (1 = Monday).
 * `time` is a local wall time, `HH:MM`, in the family time zone.
 */
export const cadenceSettingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('off') }).strict(),
  z
    .object({
      kind: z.literal('monthly'),
      day: z.union([
        z.number().int().min(1).max(28),
        z.literal('last'),
      ]),
      time: timeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('weeks'),
      every: z.number().int().min(1).max(8),
      weekday: z.number().int().min(1).max(7),
      time: timeSchema,
    })
    .strict(),
]);

/** A cadence as stored, shown and edited. */
export type CadenceSetting = z.infer<typeof cadenceSettingSchema>;
