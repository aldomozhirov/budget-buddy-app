import { z } from 'zod';

const idSchema = z.number().int().positive();

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a category name.')
  .max(60, 'Use at most 60 characters.');

/** Whether a category is for expenses or for income (CAT-1). */
export const categoryKindSchema = z.enum(['expense', 'income']);

/** One category with how it is used. */
export const categorySchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: categoryKindSchema,
  /** Filled in on an expense saved without an envelope; expenses only. */
  defaultEnvelopeId: idSchema.nullable(),
  position: z.number().int().positive(),
  archived: z.boolean(),
  archivedAt: z.number().int().nullable(),
  /** Confirmed transactions of this calendar year with this category. */
  usedThisYear: z.number().int().nonnegative(),
  /** Any transaction part names it: it can be archived, not deleted. */
  used: z.boolean(),
  /** Rules that name it; they go with it when it is deleted (O13). */
  ruleCount: z.number().int().nonnegative(),
  /** Null for the starter list (CAT-3). */
  createdBy: idSchema.nullable(),
  createdAt: z.number().int(),
  updatedBy: idSchema.nullable(),
  updatedAt: z.number().int(),
});

/** Category as returned to web clients. */
export type Category = z.infer<typeof categorySchema>;

/** Filter of `GET /api/categories`: both kinds by default. */
export const categoriesQuerySchema = z
  .object({ kind: categoryKindSchema.optional() })
  .strict();

/** Category list returned by `GET /api/categories`, active and archived. */
export const categoriesResponseSchema = z.object({
  categories: z.array(categorySchema),
});

/** Response of the routes that create or change one category. */
export const categoryResponseSchema = z.object({ category: categorySchema });

/** Path parameters of the category routes. */
export const categoryIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Validates a new category; it goes last in the list. */
export const createCategoryRequestSchema = z
  .object({
    name: nameSchema,
    kind: categoryKindSchema,
    defaultEnvelopeId: idSchema.nullable().optional(),
  })
  .strict();

/** Validated new category. */
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

/**
 * Validates a change to a category: rename, default envelope, archive or
 * restore. The kind never changes.
 */
export const updateCategoryRequestSchema = z
  .object({
    name: nameSchema.optional(),
    defaultEnvelopeId: idSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Change at least one setting.',
  );

/** Validated category change. */
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

/** Response of `DELETE /api/categories/:id`. */
export const deleteCategoryResponseSchema = z.object({
  deleted: z.literal(true),
  /** How many rules named the category and were deleted with it. */
  deletedRules: z.number().int().nonnegative(),
});
