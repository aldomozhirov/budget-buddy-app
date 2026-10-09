import { z } from 'zod';

const accountTypeSchema = z.enum([
  'bank',
  'cash',
  'investment',
  'crypto',
  'we_owe',
  'owed_to_us',
]);

const snapshotSourceSchema = z.enum([
  'opening',
  'manual',
  'checkin',
  'carried_forward',
  'photo',
  'statement',
  'connector',
]);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const minorStringSchema = z.string().regex(/^-?\d{1,19}$/u);
const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/u);

/** Account types used to group balances and wealth. */
export const accountType = accountTypeSchema;

/** Type of a stored balance snapshot. */
export const snapshotSource = snapshotSourceSchema;

/** Account and its current balance, returned by account routes. */
export const accountSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  ownerMemberId: z.number().int().positive().nullable(),
  ownerName: z.string().nullable(),
  ownerActive: z.boolean().nullable(),
  type: accountTypeSchema,
  currency: z.string(),
  active: z.boolean(),
  deactivatedAt: z.number().int().nullable(),
  balance: minorStringSchema,
  balanceTakenAt: z.number().int().nullable(),
  balanceSource: snapshotSourceSchema.nullable(),
  balanceUpdatedBy: z.number().int().positive().nullable(),
  stale: z.boolean(),
  createdBy: z.number().int().positive(),
  createdAt: z.number().int(),
  updatedBy: z.number().int().positive(),
  updatedAt: z.number().int(),
});

/** Account representation returned to web clients. */
export type Account = z.infer<typeof accountSchema>;

/** Filter options for `GET /api/accounts`. */
export const accountsQuerySchema = z
  .object({
    owner: z.coerce.number().int().positive().optional(),
    type: accountTypeSchema.optional(),
    currency: currencyCodeSchema.optional(),
    inactive: z.enum(['true', 'false']).optional(),
  })
  .strict();

/** Validated account list filters. */
export type AccountsQuery = z.infer<typeof accountsQuerySchema>;

/** Account list returned by `GET /api/accounts`. */
export const accountsResponseSchema = z.object({
  accounts: z.array(accountSchema),
});

/** Validates a new account and its optional first balance. */
export const createAccountRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter an account name.'),
    ownerMemberId: z.number().int().positive().nullable().optional(),
    type: accountTypeSchema,
    currency: currencyCodeSchema,
    openingBalance: z.string().optional(),
    openingDate: dateSchema.optional(),
  })
  .strict();

/** Account fields that can be changed without changing its status. */
export const updateAccountRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter an account name.').optional(),
    ownerMemberId: z.number().int().positive().nullable().optional(),
    type: accountTypeSchema.optional(),
  })
  .strict()
  .refine(
    (account) =>
      account.name !== undefined ||
      account.ownerMemberId !== undefined ||
      account.type !== undefined,
    'Change at least one account field.',
  );

/** Account ID in a route path. */
export const accountIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

/** A single account response. */
export const accountResponseSchema = z.object({ account: accountSchema });

/** Confirms that an account was deleted. */
export const deleteAccountResponseSchema = z.object({
  deleted: z.literal(true),
});

/** Account activation result. */
export const accountActivationResponseSchema = z.object({
  account: accountSchema,
});

/** Request to preview or confirm an account currency relabel. */
export const changeAccountCurrencyRequestSchema = z
  .object({
    currency: currencyCodeSchema,
    confirm: z.boolean().optional(),
  })
  .strict();

/** Example amounts shown before and after relabelling an account. */
export const currencyRelabelExampleSchema = z.object({
  takenAt: z.number().int(),
  beforeAmount: minorStringSchema,
  afterAmount: minorStringSchema,
});

/** A stored amount that needs rounding when currency decimals are reduced. */
export const currencyPrecisionLossSchema = z.object({
  recordType: z.enum(['snapshot', 'revision']),
  recordId: z.number().int().positive(),
  snapshotId: z.number().int().positive(),
  revisionId: z.number().int().positive().nullable(),
  takenAt: z.number().int(),
  beforeAmount: minorStringSchema,
  afterAmount: minorStringSchema,
});

/** Preview or result of changing an account's currency label. */
export const currencyRelabelResponseSchema = z.object({
  accountId: z.number().int().positive(),
  fromCurrency: currencyCodeSchema,
  toCurrency: currencyCodeSchema,
  requiresConfirmation: z.boolean(),
  example: currencyRelabelExampleSchema.nullable(),
  precisionLosses: z.array(currencyPrecisionLossSchema),
});

/** Snapshot history row, including its attribution. */
export const snapshotSchema = z.object({
  id: z.number().int().positive(),
  accountId: z.number().int().positive(),
  takenAt: z.number().int(),
  amount: minorStringSchema,
  source: snapshotSourceSchema,
  checkinId: z.number().int().positive().nullable(),
  createdBy: z.number().int().positive(),
  createdByName: z.string(),
  createdAt: z.number().int(),
  updatedBy: z.number().int().positive(),
  updatedByName: z.string(),
  updatedAt: z.number().int(),
});

/** Snapshot history value returned by account routes. */
export type Snapshot = z.infer<typeof snapshotSchema>;

/** Snapshot history for one account. */
export const snapshotsResponseSchema = z.object({
  snapshots: z.array(snapshotSchema),
});

/** Creates an opening or manually entered balance. */
export const createSnapshotRequestSchema = z
  .object({
    amount: z.string(),
    date: dateSchema.optional(),
  })
  .strict();

/** Corrects a stored snapshot's amount and/or local calendar date. */
export const updateSnapshotRequestSchema = z
  .object({
    amount: z.string().optional(),
    date: dateSchema.optional(),
  })
  .strict()
  .refine(
    (snapshot) => snapshot.amount !== undefined || snapshot.date !== undefined,
    'Change the amount or date.',
  );

/** Snapshot ID in a route path. */
export const snapshotIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

/** A single snapshot response. */
export const snapshotResponseSchema = z.object({ snapshot: snapshotSchema });

/** Confirms that a snapshot was deleted. */
export const deleteSnapshotResponseSchema = z.object({
  deleted: z.literal(true),
});

/** A previous value recorded when a snapshot was corrected or deleted. */
export const snapshotRevisionSchema = z.object({
  id: z.number().int().positive(),
  snapshotId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  action: z.enum(['update', 'delete']),
  oldAmount: minorStringSchema,
  oldTakenAt: z.number().int(),
  changedBy: z.number().int().positive(),
  changedByName: z.string(),
  changedAt: z.number().int(),
});

/** Snapshot revisions retained for account history. */
export const snapshotRevisionsResponseSchema = z.object({
  revisions: z.array(snapshotRevisionSchema),
});
