import { z } from 'zod';
import { accountType } from './accounts.js';
import { categoryKindSchema } from './categories.js';
import { ruleSchema } from './rules.js';

const idSchema = z.number().int().positive();

/** One active account as the Add form offers it: names, never a balance. */
export const addOptionsAccountSchema = z.object({
  id: idSchema,
  name: z.string(),
  ownerMemberId: idSchema.nullable(),
  ownerName: z.string().nullable(),
  type: accountType,
  currency: z.string(),
  /** Decimals of the currency, to read and format a typed amount. */
  decimals: z.number().int().min(0).max(8),
  /** Narrow symbol of the currency, such as "€", or its code. */
  symbol: z.string(),
});

/** Account as the Add form offers it. */
export type AddOptionsAccount = z.infer<typeof addOptionsAccountSchema>;

/** One merchant the family has used: its latest spelling and its key. */
export const knownMerchantSchema = z.object({
  merchant: z.string(),
  /** `merchantKey(merchant)`, under which uses are counted. */
  key: z.string(),
});

/** Known merchant as stored on the phone. */
export type KnownMerchant = z.infer<typeof knownMerchantSchema>;

/**
 * What `GET /api/add-options` returns (Design 4; D3): the names the Add form
 * needs and no amount, balance or total. The lists are ordered for the
 * profile that asked: `accounts` as in Design 3.7 (default account first),
 * `categories` as in Design 3.6 (this profile's most used in the last
 * 90 days, then the family's, then list order). `envelopes` and `rules`
 * keep list order.
 */
export const addOptionsResponseSchema = z.object({
  /** The profile the order belongs to. */
  profileId: idSchema,
  profiles: z.array(z.object({ id: idSchema, name: z.string() })),
  accounts: z.array(addOptionsAccountSchema),
  categories: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      kind: categoryKindSchema,
      /** Null unless an active envelope; expenses only. */
      defaultEnvelopeId: idSchema.nullable(),
    }),
  ),
  envelopes: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      currency: z.string(),
      /** Null unless an active expense category. */
      defaultCategoryId: idSchema.nullable(),
    }),
  ),
  rules: z.array(ruleSchema),
  /** The most recently used merchants, at most 500, newest first. */
  merchants: z.array(knownMerchantSchema),
  commonCurrency: z.string(),
  timeZone: z.string(),
});

/** Add options as returned to web clients. */
export type AddOptionsResponse = z.infer<typeof addOptionsResponseSchema>;

/** Query of `GET /api/merchants`. */
export const merchantsQuerySchema = z
  .object({
    /** Part of a merchant, in any case; empty or absent for the latest. */
    q: z.string().max(100).optional(),
    /** The account, for rules that are limited to one. */
    accountId: z.coerce.number().int().positive().optional(),
  })
  .strict();

/** Validated merchant search. */
export type MerchantsQuery = z.infer<typeof merchantsQuerySchema>;

/** The rule that would label an expense with this merchant (O9). */
export const merchantRuleSchema = z.object({
  id: idSchema,
  categoryId: idSchema,
  envelopeId: idSchema.nullable(),
});

/** A known merchant with when it was last used and its matching rule. */
export const merchantSuggestionSchema = knownMerchantSchema.extend({
  /** Date of the latest expense with this merchant (YYYY-MM-DD). */
  lastUsedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  rule: merchantRuleSchema.nullable(),
});

/** Known merchant with its matching rule. */
export type MerchantSuggestion = z.infer<typeof merchantSuggestionSchema>;

/** Response of `GET /api/merchants`: at most 20, most recently used first. */
export const merchantsResponseSchema = z.object({
  merchants: z.array(merchantSuggestionSchema),
});

/** Query of `GET /api/suggestions/categories` (Design 3.6). */
export const categorySuggestionsQuerySchema = z
  .object({
    kind: categoryKindSchema,
    merchant: z.string().max(200).optional(),
    envelopeId: z.coerce.number().int().positive().optional(),
    accountId: z.coerce.number().int().positive().optional(),
  })
  .strict();

/** Validated category suggestion query. */
export type CategorySuggestionsQuery = z.infer<
  typeof categorySuggestionsQuerySchema
>;

/** Response of `GET /api/suggestions/categories`: up to four ids in order. */
export const categorySuggestionsResponseSchema = z.object({
  categoryIds: z.array(idSchema).max(4),
});
