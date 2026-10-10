import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

/** The latest rate stored for one currency in use (CUR-4). */
export const rateCurrencyStatusSchema = z.object({
  code: z.string(),
  /** Date of the newest stored rate that involves the currency, if any. */
  latestDate: dateSchema.nullable(),
  /** Whole days from `latestDate` to today in the family's time zone. */
  ageDays: z.number().int().nonnegative().nullable(),
  /** Who published that rate. */
  source: z.string().nullable(),
});

/** The state of one price feed that serves a currency in use. */
export const rateFeedStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Epoch milliseconds of the last attempt, successful or not. */
  lastFetchAt: z.number().int().nullable(),
  /** Epoch milliseconds of the last answer the feed gave. */
  lastSuccessAt: z.number().int().nullable(),
  /** The error of the last attempt; null when that attempt worked. */
  lastError: z.object({ message: z.string(), at: z.number().int() }).nullable(),
});

/** Exchange-rate status returned by `GET /api/rates/status`. */
export const ratesStatusResponseSchema = z.object({
  /** Today's date in `timeZone`, YYYY-MM-DD. */
  today: dateSchema,
  timeZone: z.string(),
  commonCurrency: z.string(),
  /** Epoch milliseconds of the last answer from any feed. */
  lastUpdatedAt: z.number().int().nullable(),
  /** Currencies in use other than the common currency. */
  currencies: z.array(rateCurrencyStatusSchema),
  feeds: z.array(rateFeedStatusSchema),
});

/** Latest rate of one currency, as shown in the rates status sheet. */
export type RateCurrencyStatus = z.infer<typeof rateCurrencyStatusSchema>;

/** State of one price feed, as shown in the rates status sheet. */
export type RateFeedStatus = z.infer<typeof rateFeedStatusSchema>;

/** Exchange-rate status for the read-only Settings sheet. */
export type RatesStatusResponse = z.infer<typeof ratesStatusResponseSchema>;
