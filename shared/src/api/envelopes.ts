import { z } from 'zod';
import { isMinorInRange } from '../money/minor.js';

const idSchema = z.number().int().positive();
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

/** A `YYYY-MM-DD` date that exists in the calendar. */
const calendarDateSchema = dateSchema.refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}, 'Enter a date that exists.');
const minorPattern = /^-?\d{1,19}$/u;
const minorStringSchema = z.string().regex(minorPattern);
const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/u);

/** An amount in minor units that fits the 64-bit range SQLite stores. */
const amountInputSchema = z
  .string()
  .regex(minorPattern, 'Enter a whole amount in minor units.')
  .refine(
    // A failed pattern does not stop the refinements, so guard `BigInt`.
    (value) => !minorPattern.test(value) || isMinorInRange(BigInt(value)),
    'Amount is too large',
  );

/** A monthly amount: zero or more. */
const monthlyAmountInputSchema = amountInputSchema.refine(
  (value) => !value.startsWith('-'),
  'The monthly amount cannot be negative.',
);

/** A non-zero amount; the sign is given by the route's own rule. */
const nonZeroAmountInputSchema = amountInputSchema.refine(
  (value) => !minorPattern.test(value) || BigInt(value) !== 0n,
  'Enter an amount other than zero.',
);

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter an envelope name.')
  .max(60, 'Use at most 60 characters.');

const noteSchema = z
  .string()
  .trim()
  .max(200, 'Use at most 200 characters.')
  .transform((value) => (value === '' ? null : value));

/** How a top-up treats what the previous month left. */
export const envelopeModeSchema = z.enum(['carry_over', 'reset']);

/** The periods the history's statistics can cover. */
export const envelopePeriodSchema = z.enum([
  'last6',
  'last12',
  'thisYear',
  'all',
]);

/** A monthly amount and mode that apply from a month on. */
export const envelopePlanSchema = z.object({
  fromMonth: monthSchema,
  monthlyAmount: minorStringSchema,
  mode: envelopeModeSchema,
});

/** The record of one month of an envelope (all amounts in minor units). */
export const envelopeMonthSchema = z.object({
  month: monthSchema,
  opening: minorStringSchema,
  topUp: minorStringSchema,
  topUpMode: envelopeModeSchema.nullable(),
  dropped: minorStringSchema.nullable(),
  adjustments: minorStringSchema,
  spent: minorStringSchema,
  available: minorStringSchema,
  closing: minorStringSchema,
  result: minorStringSchema,
  closed: z.boolean(),
  withinBudget: z.boolean().nullable(),
  incomplete: z.boolean(),
  closingIncomplete: z.boolean(),
});

/** One envelope with its state this month. */
export const envelopeSchema = z.object({
  id: idSchema,
  name: z.string(),
  currency: z.string(),
  startingBalance: minorStringSchema,
  startingMonth: monthSchema,
  defaultCategoryId: idSchema.nullable(),
  position: z.number().int().positive(),
  archived: z.boolean(),
  archivedAt: z.number().int().nullable(),
  /** The plan in force this month. */
  plan: envelopePlanSchema.nullable(),
  /** A change that waits for next month ("From 1 November", O4). */
  pendingPlan: envelopePlanSchema.nullable(),
  /** This month's record; its `closing` is the balance. */
  current: envelopeMonthSchema.nullable(),
  /** The balance is below zero. */
  overspent: z.boolean(),
  /** An expense or an adjustment exists: the currency is fixed (ENV-7). */
  used: z.boolean(),
  /** Confirmed expenses ever charged to the envelope. */
  expenseCount: z.number().int().nonnegative(),
  /** Confirmed expenses charged in the month of `current` (O3 included). */
  monthExpenseCount: z.number().int().nonnegative(),
  createdBy: idSchema,
  createdAt: z.number().int(),
  updatedBy: idSchema,
  updatedAt: z.number().int(),
});

/** Envelope as returned to web clients. */
export type Envelope = z.infer<typeof envelopeSchema>;

/** Filter of `GET /api/envelopes`: active ones by default. */
export const envelopesQuerySchema = z
  .object({ archived: z.enum(['true', 'false']).optional() })
  .strict();

/** Envelope list returned by `GET /api/envelopes`. */
export const envelopesResponseSchema = z.object({
  envelopes: z.array(envelopeSchema),
});

/** Response of the routes that create, change or restore one envelope. */
export const envelopeResponseSchema = z.object({ envelope: envelopeSchema });

/** Path parameters of the envelope routes. */
export const envelopeIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Validates a new envelope; it starts this month (O3). */
export const createEnvelopeRequestSchema = z
  .object({
    name: nameSchema,
    currency: currencyCodeSchema,
    monthlyAmount: monthlyAmountInputSchema,
    mode: envelopeModeSchema,
    /** Minor units, signed; zero when left out. */
    startingBalance: amountInputSchema.optional(),
    defaultCategoryId: idSchema.nullable().optional(),
  })
  .strict();

/** Validated new envelope. */
export type CreateEnvelopeRequest = z.infer<typeof createEnvelopeRequestSchema>;

/**
 * Validates a change to an envelope. `monthlyAmount` and `mode` write the
 * plan of the next month (O4). A new `currency` needs `confirm: true`, since
 * it relabels the stored amounts without converting them (O6).
 */
export const updateEnvelopeRequestSchema = z
  .object({
    name: nameSchema.optional(),
    defaultCategoryId: idSchema.nullable().optional(),
    startingBalance: amountInputSchema.optional(),
    currency: currencyCodeSchema.optional(),
    confirm: z.boolean().optional(),
    monthlyAmount: monthlyAmountInputSchema.optional(),
    mode: envelopeModeSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.entries(value).some(
        ([key, entry]) => key !== 'confirm' && entry !== undefined,
      ),
    'Change at least one setting.',
  );

/** Validated envelope change. */
export type UpdateEnvelopeRequest = z.infer<typeof updateEnvelopeRequestSchema>;

/** `GET /api/envelopes/:id?month=`: the month defaults to this one. */
export const envelopeDetailQuerySchema = z
  .object({ month: monthSchema.optional() })
  .strict();

/** An expense charged to the envelope in a month. */
export const envelopeExpenseSchema = z.object({
  transactionId: idSchema,
  date: dateSchema,
  merchant: z.string().nullable(),
  note: z.string().nullable(),
  /** The part's amount in the account's currency. */
  amount: minorStringSchema,
  accountCurrency: z.string(),
  /** In the envelope's currency; null while its rate is missing. */
  envelopeAmount: minorStringSchema.nullable(),
  memberId: idSchema,
});

/** An adjustment or one side of a move. */
export const envelopeAdjustmentSchema = z.object({
  id: idSchema,
  envelopeId: idSchema,
  date: dateSchema,
  amount: minorStringSchema,
  note: z.string().nullable(),
  moveId: z.string().nullable(),
  /** The other envelope of a move. */
  counterpartEnvelopeId: idSchema.nullable(),
  createdBy: idSchema,
  createdAt: z.number().int(),
});

/** Adjustment as returned to web clients. */
export type EnvelopeAdjustment = z.infer<typeof envelopeAdjustmentSchema>;

/** One envelope with the record, expenses and adjustments of a month. */
export const envelopeDetailResponseSchema = z.object({
  envelope: envelopeSchema,
  month: envelopeMonthSchema,
  expenses: z.array(envelopeExpenseSchema),
  adjustments: z.array(envelopeAdjustmentSchema),
});

/** `GET /api/envelopes/:id/history?period=`: last 6 months by default. */
export const envelopeHistoryQuerySchema = z
  .object({ period: envelopePeriodSchema.optional() })
  .strict();

/** The statistics of the closed months of a period (Design 3.2). */
export const envelopeStatisticsSchema = z.object({
  months: z.number().int().nonnegative(),
  withinBudget: z.number().int().nonnegative(),
  averageSpent: minorStringSchema.nullable(),
  largestOverspend: z
    .object({ month: monthSchema, amount: minorStringSchema })
    .nullable(),
  leftOverNet: minorStringSchema,
  incomplete: z.boolean(),
});

/** Monthly records of a period (and this month) with their statistics. */
export const envelopeHistoryResponseSchema = z.object({
  envelopeId: idSchema,
  currency: z.string(),
  period: envelopePeriodSchema,
  months: z.array(envelopeMonthSchema),
  statistics: envelopeStatisticsSchema,
});

/** Validates a hand adjustment: signed, not zero; dated today by default. */
export const createAdjustmentRequestSchema = z
  .object({
    amount: nonZeroAmountInputSchema,
    note: noteSchema.optional(),
    date: calendarDateSchema.optional(),
  })
  .strict();

/** Response of `POST /api/envelopes/:id/adjustments`. */
export const adjustmentResponseSchema = z.object({
  adjustment: envelopeAdjustmentSchema,
});

/** Validates a move between two envelopes of the same currency (O5). */
export const createMoveRequestSchema = z
  .object({
    fromEnvelopeId: idSchema,
    toEnvelopeId: idSchema,
    amount: nonZeroAmountInputSchema.refine(
      (value) => !value.startsWith('-'),
      'Enter an amount above zero.',
    ),
    note: noteSchema.optional(),
    date: calendarDateSchema.optional(),
  })
  .strict();

/** Response of `POST /api/envelopes/moves`: the two rows, source first. */
export const moveResponseSchema = z.object({
  moveId: z.string(),
  adjustments: z.array(envelopeAdjustmentSchema).length(2),
});

/** Path parameters of `DELETE /api/envelope-adjustments/:id`. */
export const adjustmentIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Response of the delete routes; `count` is the adjustment rows removed. */
export const deleteEnvelopeResponseSchema = z.object({
  deleted: z.literal(true),
  count: z.number().int().positive().optional(),
});
