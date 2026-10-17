import { z } from 'zod';

const idSchema = z.number().int().positive();
const minorStringSchema = z.string().regex(/^-?\d{1,19}$/u);

/** Validates `GET /api/transactions/needs-category` (CAT-7). */
export const needsCategoryQuerySchema = z
  .object({
    /** The `nextCursor` of the page before (`YYYY-MM-DD:id`). */
    cursor: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}:[1-9]\d{0,17}$/u, 'Use the cursor given.')
      .optional(),
  })
  .strict();

/** The category a row in "Needs a category" proposes (Design 3.6). */
export const categorySuggestionSchema = z.object({
  categoryId: idSchema,
  categoryName: z.string(),
});

/** One expense or income that waits for a category, with its suggestion. */
export const needsCategoryRowSchema = z.object({
  id: idSchema,
  kind: z.enum(['expense', 'income']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  accountId: idSchema,
  accountName: z.string(),
  currency: z.string(),
  /** In `currency`; below zero for a refund. */
  amount: minorStringSchema,
  memberId: idSchema,
  memberName: z.string(),
  merchant: z.string().nullable(),
  /** Null only when no active category of the kind exists. */
  suggestion: categorySuggestionSchema.nullable(),
});

/** Row of "Needs a category". */
export type NeedsCategoryRow = z.infer<typeof needsCategoryRowSchema>;

/** Response of `GET /api/transactions/needs-category`. */
export const needsCategoryResponseSchema = z.object({
  /** Newest first: by date, then id; at most 50. */
  transactions: z.array(needsCategoryRowSchema),
  /** Send as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
  /** Everything that waits, not only this page. */
  count: z.number().int().nonnegative(),
});

/** Response of the "Needs a category" list. */
export type NeedsCategoryResponse = z.infer<typeof needsCategoryResponseSchema>;

/**
 * Validates `POST /api/transactions/label`: a category for each of several
 * transactions, or `null` to take a labelling back (the undo). An undo may
 * name the envelope the labelling filled in `takeBackEnvelopeId`; it is
 * cleared only while the transaction still has that envelope.
 */
export const labelTransactionsRequestSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: idSchema,
            categoryId: idSchema.nullable(),
            takeBackEnvelopeId: idSchema.optional(),
          })
          .strict()
          .refine(
            (item) =>
              item.takeBackEnvelopeId === undefined || item.categoryId === null,
            {
              path: ['takeBackEnvelopeId'],
              message: 'Only an undo takes an envelope back.',
            },
          ),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (body) =>
      new Set(body.items.map((item) => item.id)).size === body.items.length,
    { path: ['items'], message: 'Each transaction can be listed once.' },
  );

/** Request to label (or unlabel) several transactions at once. */
export type LabelTransactionsRequest = z.infer<
  typeof labelTransactionsRequestSchema
>;

/** Response of `POST /api/transactions/label`. */
export const labelTransactionsResponseSchema = z.object({
  /** The transactions changed, in the order of the request. */
  labelled: z.array(
    z.object({
      id: idSchema,
      /** The category now; null after an undo. */
      categoryId: idSchema.nullable(),
      /**
       * The envelope this call gave an expense that had none, from the
       * category's default (O7); null when none was filled.
       */
      filledEnvelopeId: idSchema.nullable(),
      filledEnvelopeName: z.string().nullable(),
    }),
  ),
  /** Ids that were gone, or no longer waiting, and so left unchanged. */
  skipped: z.array(idSchema),
  /** What still waits, after this call. */
  count: z.number().int().nonnegative(),
});

/** Response of labelling. */
export type LabelTransactionsResponse = z.infer<
  typeof labelTransactionsResponseSchema
>;
