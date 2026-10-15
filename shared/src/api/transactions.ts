import { z } from 'zod';
import { isMinorInRange } from '../money/minor.js';

const idSchema = z.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const minorPattern = /^-?\d{1,19}$/u;
const minorStringSchema = z.string().regex(minorPattern);

/** A `YYYY-MM-DD` date that exists in the calendar, from 2000 on (3.4). */
const transactionDateSchema = dateSchema
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  }, 'Enter a date that exists.')
  .refine(
    (value) => value >= '2000-01-01',
    'Choose a date from 1 January 2000 on.',
  );

/** An amount in minor units that fits the 64-bit range SQLite stores. */
const amountInputSchema = z
  .string()
  .regex(minorPattern, 'Enter a whole amount in minor units.')
  .refine(
    // A failed pattern does not stop the refinements, so guard `BigInt`.
    (value) => !minorPattern.test(value) || isMinorInRange(BigInt(value)),
    'Amount is too large',
  );

/** Optional text: trimmed, and empty means none. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const merchantSchema = optionalText(120);
const noteSchema = optionalText(500);

/** What a transaction records (TXN-1, TXN-3, TXN-4). It never changes. */
export const transactionKindSchema = z.enum(['expense', 'income', 'transfer']);

/** Kind of a transaction. */
export type TransactionKind = z.infer<typeof transactionKindSchema>;

/**
 * The amount rules of each kind (Design 3.4): an expense is non-zero (below
 * zero for a refund, TXN-8), income and both sides of a transfer are above
 * zero. Only a transfer has a receiving side, and only an expense has an
 * envelope or a merchant; a transfer has no category.
 */
function checkKindShape(
  value: {
    kind: TransactionKind;
    amount: string;
    toAccountId?: number | null | undefined;
    toAmount?: string | null | undefined;
    merchant?: string | null | undefined;
    categoryId?: number | null | undefined;
    envelopeId?: number | null | undefined;
  },
  context: z.RefinementCtx,
): void {
  const issue = (path: string, message: string) =>
    context.addIssue({ code: 'custom', path: [path], message });
  const amount = minorPattern.test(value.amount)
    ? BigInt(value.amount)
    : undefined;
  if (value.kind === 'expense' && amount === 0n) {
    issue('amount', 'Enter an amount other than zero.');
  }
  if (value.kind !== 'expense' && amount !== undefined && amount <= 0n) {
    issue('amount', 'Enter an amount above zero.');
  }
  if (value.kind === 'transfer') {
    if (value.toAccountId === undefined || value.toAccountId === null) {
      issue('toAccountId', 'Choose the account the money goes to.');
    }
    if (
      value.toAmount !== undefined &&
      value.toAmount !== null &&
      minorPattern.test(value.toAmount) &&
      BigInt(value.toAmount) <= 0n
    ) {
      issue('toAmount', 'Enter an amount above zero.');
    }
    if (value.categoryId !== undefined && value.categoryId !== null) {
      issue('categoryId', 'A transfer has no category.');
    }
  } else {
    if (value.toAccountId !== undefined && value.toAccountId !== null) {
      issue('toAccountId', 'Only a transfer goes to another account.');
    }
    if (value.toAmount !== undefined && value.toAmount !== null) {
      issue('toAmount', 'Only a transfer has an amount that arrives.');
    }
  }
  if (value.kind !== 'expense') {
    if (value.envelopeId !== undefined && value.envelopeId !== null) {
      issue('envelopeId', 'Only an expense goes to an envelope.');
    }
    if (value.merchant !== undefined && value.merchant !== null) {
      issue('merchant', 'Only an expense has a merchant.');
    }
  }
}

/**
 * Validates `POST /api/transactions` (TXN-1 to TXN-5, TXN-7). Only the kind,
 * the account and the amount are needed: the date defaults to today in the
 * family time zone and the payer to the session's profile. Amounts are minor
 * units of the account's currency (D4). A transfer between accounts of one
 * currency may leave out `toAmount`, which then equals `amount`.
 */
export const createTransactionRequestSchema = z
  .object({
    /** The device's id for the item, so a retry is not saved twice. */
    clientId: z.uuid('Send a UUID as the client id.').optional(),
    kind: transactionKindSchema,
    date: transactionDateSchema.optional(),
    accountId: idSchema,
    amount: amountInputSchema,
    toAccountId: idSchema.nullable().optional(),
    toAmount: amountInputSchema.nullable().optional(),
    /** Paid by, received by or done by; the session's profile by default. */
    memberId: idSchema.optional(),
    merchant: merchantSchema.optional(),
    note: noteSchema.optional(),
    categoryId: idSchema.nullable().optional(),
    envelopeId: idSchema.nullable().optional(),
    /** When it was typed on the device, UTC epoch milliseconds. */
    enteredAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine(checkKindShape);

/** Validated new transaction. */
export type CreateTransactionRequest = z.infer<
  typeof createTransactionRequestSchema
>;

/**
 * Validates `PATCH /api/transactions/:id`: any field but the kind (3.4).
 * Null clears an optional field. `envelopeAmount` is the envelope amount
 * typed by hand (3.3), in minor units of the envelope's currency; null goes
 * back to the converted one. The rules of the stored kind are checked by the
 * server against the result.
 */
export const updateTransactionRequestSchema = z
  .object({
    date: transactionDateSchema.optional(),
    accountId: idSchema.optional(),
    amount: amountInputSchema.optional(),
    toAccountId: idSchema.optional(),
    toAmount: amountInputSchema.optional(),
    memberId: idSchema.optional(),
    merchant: merchantSchema.optional(),
    note: noteSchema.optional(),
    categoryId: idSchema.nullable().optional(),
    envelopeId: idSchema.nullable().optional(),
    envelopeAmount: amountInputSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Change at least one field.',
  );

/** Validated transaction change. */
export type UpdateTransactionRequest = z.infer<
  typeof updateTransactionRequestSchema
>;

/** Path parameters of the transaction routes. */
export const transactionIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * The rate an expense's envelope amount was converted at (UI-TXN-5): units of
 * the envelope's currency per one whole unit of the account's, and the date
 * of the rate ("At the rate of 2 October: $1 = €0.9149.").
 */
export const envelopeRateSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Exact decimal string in plain notation. */
  rate: z.string(),
  date: dateSchema,
});

/**
 * One transaction. Spec 2 stores one part per expense or income (D5), so its
 * category, envelope and envelope amount are given on the transaction.
 * Amounts are minor-unit strings: `amount` in `currency` (the account's),
 * `toAmount` in `toCurrency`, `envelopeAmount` in `envelopeCurrency`.
 */
export const transactionSchema = z.object({
  id: idSchema,
  clientId: z.string().nullable(),
  kind: transactionKindSchema,
  status: z.enum(['draft', 'confirmed']),
  date: dateSchema,
  accountId: idSchema,
  currency: z.string(),
  amount: minorStringSchema,
  toAccountId: idSchema.nullable(),
  toCurrency: z.string().nullable(),
  toAmount: minorStringSchema.nullable(),
  memberId: idSchema,
  merchant: z.string().nullable(),
  note: z.string().nullable(),
  categoryId: idSchema.nullable(),
  envelopeId: idSchema.nullable(),
  envelopeCurrency: z.string().nullable(),
  /** Null with an envelope: no rate yet to convert with (3.3). */
  envelopeAmount: minorStringSchema.nullable(),
  /** The envelope amount was typed by hand. */
  envelopeAmountManual: z.boolean(),
  /**
   * The rate of a converted envelope amount; null for the same currency, a
   * missing amount and one typed by hand.
   */
  envelopeRate: envelopeRateSchema.nullable(),
  source: z.enum(['typed', 'photo', 'apple_pay', 'statement', 'connector']),
  enteredAt: z.number().int().nullable(),
  createdBy: idSchema,
  createdAt: z.number().int(),
  updatedBy: idSchema,
  updatedAt: z.number().int(),
});

/** Transaction as returned to web clients. */
export type Transaction = z.infer<typeof transactionSchema>;

/** An old and a new value of a field; null where there is none. */
const changePair = <T extends z.ZodType>(value: T) =>
  z.tuple([value.nullable(), value.nullable()]).optional();

/**
 * The `changes` of a revision (MEM-5; Design 3.9): `{field: [old, new]}`
 * with amounts as minor-unit strings and ids as numbers. An update holds the
 * fields that changed; a delete holds every field, each as `[old, null]`.
 * Amounts are in the currency of the account (or envelope) of the same
 * moment.
 */
export const transactionChangesSchema = z
  .object({
    clientId: changePair(z.string()),
    kind: changePair(transactionKindSchema),
    status: changePair(z.enum(['draft', 'confirmed'])),
    date: changePair(dateSchema),
    accountId: changePair(idSchema),
    amount: changePair(minorStringSchema),
    toAccountId: changePair(idSchema),
    toAmount: changePair(minorStringSchema),
    memberId: changePair(idSchema),
    merchant: changePair(z.string()),
    note: changePair(z.string()),
    categoryId: changePair(idSchema),
    envelopeId: changePair(idSchema),
    envelopeAmount: changePair(minorStringSchema),
    envelopeAmountManual: changePair(z.boolean()),
    source: changePair(z.string()),
    enteredAt: changePair(z.number().int()),
    createdBy: changePair(idSchema),
    createdAt: changePair(z.number().int()),
  })
  .strict();

/** Changed fields of one revision. */
export type TransactionChanges = z.infer<typeof transactionChangesSchema>;

/** One entry of a transaction's record (UI-TXN-7). */
export const transactionRevisionSchema = z.object({
  id: idSchema,
  action: z.enum(['update', 'delete']),
  changes: transactionChangesSchema,
  changedBy: idSchema,
  changedAt: z.number().int(),
});

/** Revision as returned to web clients. */
export type TransactionRevision = z.infer<typeof transactionRevisionSchema>;

/** Response of `GET` and `PATCH /api/transactions/:id`: oldest change first. */
export const transactionResponseSchema = z.object({
  transaction: transactionSchema,
  revisions: z.array(transactionRevisionSchema),
});

/**
 * Response of `POST /api/transactions`: 201 when created, 200 for a retry
 * of the same request, which repeats nothing and reports nothing filled.
 */
export const createTransactionResponseSchema = z.object({
  transaction: transactionSchema,
  /** What the on-save fill set (Design 3.5). */
  filled: z.object({
    envelope: z.literal('category').optional(),
    category: z.literal('envelope').optional(),
  }),
});

/** Response of `DELETE /api/transactions/:id`. */
export const deleteTransactionResponseSchema = z.object({
  deleted: z.literal(true),
});
