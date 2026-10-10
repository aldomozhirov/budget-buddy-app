import { z } from 'zod';
import { accountType } from './accounts.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const minorStringSchema = z.string().regex(/^-?\d{1,19}$/u);
const idSchema = z.number().int().positive();

/** Which way a total moved between two check-ins. */
export const changeDirectionSchema = z.enum(['up', 'down', 'unchanged']);

/** An account named in a summary list. */
export const summaryAccountSchema = z.object({
  accountId: idSchema,
  name: z.string(),
  ownerName: z.string().nullable(),
  currency: z.string(),
});

/** The family total of one currency, in its own unit (SUM-2, SUM-3). */
export const summaryCurrencySchema = z.object({
  currency: z.string(),
  current: minorStringSchema,
  /** Null in the first check-in. */
  previous: minorStringSchema.nullable(),
  difference: minorStringSchema.nullable(),
  direction: changeDirectionSchema.nullable(),
  /** `current` in the common currency at this check-in's rates. */
  currentEquivalent: minorStringSchema.nullable(),
  /** `previous` in the common currency at the previous check-in's rates. */
  previousEquivalent: minorStringSchema.nullable(),
});

/** One change of an account, in its own currency and the common one. */
export const summaryAccountChangeSchema = summaryAccountSchema.extend({
  /** The account's type, for the row's subtitle. */
  type: accountType,
  /** Closing minus opening balance, in the account's currency. */
  change: minorStringSchema,
  /** The change in the common currency at this check-in's rates. */
  changeEquivalent: minorStringSchema,
});

/** A rate a conversion needed and could not find (CUR-4). */
export const missingRateSchema = z.object({
  currency: z.string(),
  /** The date the rate was looked up for, YYYY-MM-DD. */
  date: dateSchema,
});

/**
 * Summary of a closed check-in (SUM-1 to SUM-6). Equivalents are in the common
 * currency; an equivalent that needs a missing rate is null, never a guess.
 */
export const checkinSummarySchema = z.object({
  checkin: z.object({
    id: idSchema,
    closedAt: z.number().int(),
    /** Closing day in the family's time zone, whose rates value the totals. */
    date: dateSchema,
    closedBy: z.object({ memberId: idSchema, name: z.string() }).nullable(),
  }),
  /** The previous closed check-in; null for the first one. */
  previous: z
    .object({ id: idSchema, closedAt: z.number().int(), date: dateSchema })
    .nullable(),
  commonCurrency: z.string(),
  timeZone: z.string(),
  currencies: z.array(summaryCurrencySchema),
  total: z.object({
    current: minorStringSchema.nullable(),
    previous: minorStringSchema.nullable(),
    change: minorStringSchema.nullable(),
    direction: changeDirectionSchema.nullable(),
    /** False when a rate is missing and the totals above are null. */
    complete: z.boolean(),
  }),
  missingRates: z.array(missingRateSchema),
  /** Sum of the per-account changes; null in the first check-in. */
  fromBalances: minorStringSchema.nullable(),
  /** The total change minus `fromBalances`, so the two always add up. */
  fromExchangeRates: minorStringSchema.nullable(),
  byMember: z.array(
    z.object({
      memberId: idSchema.nullable(),
      name: z.string().nullable(),
      change: minorStringSchema.nullable(),
    }),
  ),
  byType: z.array(
    z.object({ type: accountType, change: minorStringSchema.nullable() }),
  ),
  biggestChanges: z.array(summaryAccountChangeSchema),
  alsoInThisCheckin: z.object({
    /** Carried forward at close: "wasn't changed". */
    notChanged: z.array(summaryAccountSchema),
    /** First balance after the previous check-in. */
    added: z.array(summaryAccountSchema),
    /** Deactivated since the previous check-in. */
    deactivated: z.array(summaryAccountSchema),
  }),
});

/** The summary returned by `GET /api/checkins/:id/summary`. */
export type CheckinSummary = z.infer<typeof checkinSummarySchema>;

/** Query of `GET /api/wealth/series`. */
export const wealthSeriesQuerySchema = z
  .object({
    view: z.enum(['equivalent', 'currency']).default('equivalent'),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,10}$/u)
      .optional(),
    rates: z.enum(['dated', 'today']).default('dated'),
  })
  .strict()
  .refine(
    (query) => query.view !== 'currency' || query.currency !== undefined,
    {
      path: ['currency'],
      message: 'Choose a currency.',
    },
  );

/** One closed check-in on the chart (SUM-4). */
export const wealthPointSchema = z.object({
  checkinId: idSchema,
  closedAt: z.number().int(),
  date: dateSchema,
  /** Null when the point needs a rate that is missing. */
  amount: minorStringSchema.nullable(),
});

/** The chart series returned by `GET /api/wealth/series`. */
export const wealthSeriesSchema = z.object({
  view: z.enum(['equivalent', 'currency']),
  /** The unit of `amount`: the common currency or the chosen one. */
  currency: z.string(),
  rates: z.enum(['dated', 'today']),
  /** Every currency with an account, for the chart's pills. */
  currencies: z.array(z.string()),
  points: z.array(wealthPointSchema),
  /** True when any point is null because of a missing rate. */
  incomplete: z.boolean(),
});

/** The chart series of closed check-ins. */
export type WealthSeries = z.infer<typeof wealthSeriesSchema>;
