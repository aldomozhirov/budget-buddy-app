import { z } from 'zod';

const coinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/u, 'Use 2 to 10 letters or digits.');

const coinNameSchema = z.string().trim().min(1, 'Enter a coin name.').max(80);

const coinDecimalsSchema = z
  .number()
  .int('Enter a whole number of decimals.')
  .min(0, 'Decimals cannot be negative.')
  .max(8, 'Stored with at most 8 decimals');

/** Coin definition and whether it is required by saved family data. */
export const coinSchema = z.object({
  code: coinCodeSchema,
  name: z.string(),
  decimals: z.number().int().min(0).max(8),
  inUse: z.boolean(),
});

/** Coin shown in the Settings coin list. */
export type CoinSetting = z.infer<typeof coinSchema>;

/** Fiat or coin choice returned for a currency picker. */
export const currencyOptionSchema = z.object({
  code: z.string(),
  name: z.string(),
  decimals: z.number().int().min(0).max(8),
  kind: z.enum(['fiat', 'coin']),
  symbol: z.string(),
});

/** ISO currency or coin available to a currency picker. */
export type CurrencyOption = z.infer<typeof currencyOptionSchema>;

/** Currency choices plus every coin configured in Settings. */
export const currenciesResponseSchema = z.object({
  currencies: z.array(currencyOptionSchema),
  coins: z.array(coinSchema),
});

/** Currency list returned by `GET /api/currencies`. */
export type CurrenciesResponse = z.infer<typeof currenciesResponseSchema>;

/** Validates a new coin definition. */
export const createCoinRequestSchema = z
  .object({
    code: coinCodeSchema,
    name: coinNameSchema,
    decimals: coinDecimalsSchema,
  })
  .strict();

/** Validates a partial update to an existing coin definition. */
export const updateCoinRequestSchema = z
  .object({
    code: coinCodeSchema.optional(),
    name: coinNameSchema.optional(),
    decimals: coinDecimalsSchema.optional(),
  })
  .strict()
  .refine(
    (coin) =>
      coin.code !== undefined ||
      coin.name !== undefined ||
      coin.decimals !== undefined,
    'Change at least one coin field.',
  );

/** Validates a coin code in a route path. */
export const coinCodeParamsSchema = z.object({ code: coinCodeSchema }).strict();

/** Coin returned after it is created or updated. */
export const coinResponseSchema = z.object({ coin: coinSchema });

/** Confirms a coin was removed. */
export const deleteCoinResponseSchema = z.object({ deleted: z.literal(true) });
