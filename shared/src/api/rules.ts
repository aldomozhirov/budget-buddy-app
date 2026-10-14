import { z } from 'zod';
import { ruleWords } from '../spending/rules.js';

const idSchema = z.number().int().positive();

/** A pattern needs at least one word between its commas. */
const patternSchema = z
  .string()
  .trim()
  .min(1, 'Enter at least one word.')
  .max(200, 'Use at most 200 characters.')
  .refine((value) => ruleWords(value).length > 0, 'Enter at least one word.');

/** One merchant rule (CAT-6); the list order is the order rules are tried. */
export const ruleSchema = z.object({
  id: idSchema,
  position: z.number().int().positive(),
  /** As typed: "REWE, EDEKA, LIDL, ALDI". */
  pattern: z.string(),
  categoryId: idSchema,
  envelopeId: idSchema.nullable(),
  /** The rule applies to this account only; null for every account. */
  accountId: idSchema.nullable(),
  categoryArchived: z.boolean(),
  envelopeArchived: z.boolean(),
  createdBy: idSchema,
  createdAt: z.number().int(),
  updatedBy: idSchema,
  updatedAt: z.number().int(),
});

/** Rule as returned to web clients. */
export type Rule = z.infer<typeof ruleSchema>;

/** Rule list returned by `GET /api/rules` and `PUT /api/rules/order`. */
export const rulesResponseSchema = z.object({ rules: z.array(ruleSchema) });

/** Response of the routes that create or change one rule. */
export const ruleResponseSchema = z.object({ rule: ruleSchema });

/** Path parameters of the rule routes. */
export const ruleIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Validates a new rule. `placement` says where it goes in the list: last by
 * default, first for "Save rule" on a transaction (O9).
 */
export const createRuleRequestSchema = z
  .object({
    pattern: patternSchema,
    categoryId: idSchema,
    envelopeId: idSchema.nullable().optional(),
    accountId: idSchema.nullable().optional(),
    placement: z.enum(['first', 'last']).optional(),
  })
  .strict();

/** Validated new rule. */
export type CreateRuleRequest = z.infer<typeof createRuleRequestSchema>;

/** Validates a change to a rule; its place in the list is not changed. */
export const updateRuleRequestSchema = z
  .object({
    pattern: patternSchema.optional(),
    categoryId: idSchema.optional(),
    envelopeId: idSchema.nullable().optional(),
    accountId: idSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Change at least one setting.',
  );

/** Validated rule change. */
export type UpdateRuleRequest = z.infer<typeof updateRuleRequestSchema>;

/** Validates the full list of rule ids in their new order. */
export const reorderRulesRequestSchema = z
  .object({ ids: z.array(idSchema) })
  .strict()
  .refine(
    (value) => new Set(value.ids).size === value.ids.length,
    'Name every rule once.',
  );

/** Response of `DELETE /api/rules/:id`. */
export const deleteRuleResponseSchema = z.object({ deleted: z.literal(true) });
