import { z } from 'zod';
import { isMinorInRange } from '../money/minor.js';

const idSchema = z.number().int().positive();
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const minorStringSchema = z.string().regex(/^-?\d{1,19}$/u);

const minorPattern = /^\d{1,19}$/u;

/** A positive amount in minor units that fits the 64-bit range SQLite keeps. */
const wishAmountSchema = z
  .string()
  .regex(minorPattern, 'Enter a whole amount in minor units.')
  .refine(
    (value) => !minorPattern.test(value) || BigInt(value) > 0n,
    'Enter an amount above zero.',
  )
  .refine(
    // A failed pattern does not stop the refinements, so guard `BigInt`.
    (value) => !minorPattern.test(value) || isMinorInRange(BigInt(value)),
    'Amount is too large',
  );

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(80, 'Use at most 80 characters.');

/** An optional text that is stored as null when left empty. */
const noteSchema = z
  .string()
  .trim()
  .max(500, 'Use at most 500 characters.')
  .transform((value) => (value === '' ? null : value))
  .nullable();

/**
 * What the member typed for the amount (PLN-16): at most 120 characters of
 * digits, spaces and the signs `+ − - × ÷ * / ( ) . ,`. It is stored as typed
 * and never evaluated by the server.
 */
const expressionSchema = z
  .string()
  .max(120, 'Use at most 120 characters.')
  .regex(/^[0-9 +\-−×÷*/().,]*$/u, 'Use digits and the signs + − × ÷ ( ) only.')
  .transform((value) => (value.trim() === '' ? null : value))
  .nullable();

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/u);

/** The three states of a wish (PLN-9, UI-WSH-2). */
export const wishStateSchema = z.enum(['open', 'done', 'dropped']);

/** The state of a wish. */
export type WishState = z.infer<typeof wishStateSchema>;

/**
 * What an Undo call expects the wish to still have; if it does not, the
 * answer is 409 `changed`.
 */
export const wishExpectSchema = z.object({
  state: wishStateSchema.optional(),
  month: monthSchema.optional(),
});

/** Path parameters of the routes of one wish. */
export const wishIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Query of `GET /api/wishes`; the month defaults to the current one. */
export const wishesQuerySchema = z.object({ month: monthSchema.optional() });

/** Body of `POST /api/wishes`. */
export const createWishRequestSchema = z.object({
  month: monthSchema,
  name: nameSchema,
  /** In the minor units of `currency`. */
  amount: wishAmountSchema,
  expression: expressionSchema.optional(),
  currency: currencyCodeSchema,
  categoryId: idSchema.nullable().optional(),
  note: noteSchema.optional(),
});

/** Body of `PATCH /api/wishes/:id`: any field, and the state changes. */
export const updateWishRequestSchema = z
  .object({
    name: nameSchema,
    amount: wishAmountSchema,
    expression: expressionSchema,
    currency: currencyCodeSchema,
    categoryId: idSchema.nullable(),
    note: noteSchema,
    state: wishStateSchema,
    expect: wishExpectSchema,
  })
  .partial()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'expect'),
    'Change at least one thing.',
  );

/** Body of `POST /api/wishes/:id/move` (PLN-11, UI-WSH-4). */
export const moveWishRequestSchema = z.object({
  /** The month to move to: the next one, or back to the current one. */
  month: monthSchema,
  expect: wishExpectSchema.optional(),
});

/** How an expense came to count for a wish. */
export const wishLinkMadeHowSchema = z.enum(['recorded', 'member']);

/** An expense that counts for a wish, as "Spent on it" lists it. */
export const wishExpenseSchema = z.object({
  transactionId: idSchema,
  merchant: z.string().nullable(),
  note: z.string().nullable(),
  date: dateSchema,
  accountId: idSchema,
  accountName: z.string(),
  /** The expense's own amount, in the account's currency. */
  amount: minorStringSchema,
  currency: z.string(),
  /** What it counts as, in the wish's currency; null: rate missing. */
  linkAmount: minorStringSchema.nullable(),
  madeHow: wishLinkMadeHowSchema,
  /** The member who linked it; null for a link made by the app. */
  madeBy: z.string().nullable(),
});

/** An expense linked to a wish. */
export type WishExpense = z.infer<typeof wishExpenseSchema>;

/** A wish with what was spent on it (PLN-10, UI-WSH-2). */
export const wishSchema = z.object({
  id: idSchema,
  month: monthSchema,
  name: z.string(),
  /** In the minor units of `currency`. */
  amount: minorStringSchema,
  /** As typed by the member; the server never evaluates it. */
  expression: z.string().nullable(),
  currency: z.string(),
  categoryId: idSchema.nullable(),
  categoryName: z.string().nullable(),
  note: z.string().nullable(),
  state: wishStateSchema,
  /** The sum of the linked expenses' amounts, in the wish's currency. */
  spent: minorStringSchema,
  /** `amount − spent`; negative when over. */
  left: minorStringSchema,
  /** `spent − amount` when positive, else 0. */
  over: minorStringSchema,
  /** `amount − spent` when a done wish spent less, else 0 (UI-WSH-2). */
  under: minorStringSchema,
  /** A linked expense has no amount yet (rate missing), so `spent` is short. */
  incomplete: z.boolean(),
  expenseCount: z.number().int().nonnegative(),
  expenses: z.array(wishExpenseSchema),
  createdBy: idSchema,
  createdByName: z.string(),
  createdAt: z.number().int(),
  updatedBy: idSchema,
  updatedByName: z.string(),
  updatedAt: z.number().int(),
});

/** A wish as returned to web clients. */
export type Wish = z.infer<typeof wishSchema>;

/** The month's total of the wishes that are not dropped (UI-WSH-2). */
export const wishesTotalSchema = z.object({
  /** In the common currency, minor units; null when nothing is counted. */
  amount: minorStringSchema.nullable(),
  currency: z.string(),
  /** A currency has no rate, so `amount` leaves it out. */
  incomplete: z.boolean(),
  /** Converted at the latest stored rate, because the month has not begun. */
  estimated: z.boolean(),
});

/** Response of `GET /api/wishes`. */
export const wishesResponseSchema = z.object({
  month: monthSchema,
  wishes: z.array(wishSchema),
  counts: z.object({
    /** All wishes of the month, dropped ones included. */
    total: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
  }),
  total: wishesTotalSchema,
});

/** Response of `GET /api/wishes`. */
export type WishesResponse = z.infer<typeof wishesResponseSchema>;

/** Response of the routes that return one wish. */
export const wishResponseSchema = z.object({ wish: wishSchema });

/** Response of `POST /api/wishes/:id/restore`. */
export const restoreWishResponseSchema = z.object({
  wish: wishSchema,
  /** Transactions whose link could not be reattached. */
  notRestored: z.array(idSchema),
});
