import { z } from 'zod';
import { snapshotSource } from './accounts.js';

const minorStringSchema = z.string().regex(/^-?\d{1,19}$/u);

/** Value saved for one account during a check-in. */
export const checkinValueSchema = z.object({
  snapshotId: z.number().int().positive(),
  amount: minorStringSchema,
  source: snapshotSource,
  takenAt: z.number().int(),
});

/** Account details and its pre-check-in balance shown in an open round. */
export const checkinAccountSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  currency: z.string(),
  balance: minorStringSchema,
  balanceTakenAt: z.number().int().nullable(),
  balanceSource: snapshotSource.nullable(),
  value: checkinValueSchema.nullable(),
});

/** Progress for a profile or the unassigned accounts in a check-in. */
export const checkinMemberProgressSchema = z.object({
  memberId: z.number().int().positive().nullable(),
  name: z.string().nullable(),
  active: z.boolean().nullable(),
  accounts: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  done: z.boolean(),
});

/** A profile tab and its accounts for the check-in screen. */
export const checkinMemberSchema = checkinMemberProgressSchema.extend({
  accountList: z.array(checkinAccountSchema),
});

/** One open or closed check-in with account values and per-profile progress. */
export const checkinSchema = z.object({
  id: z.number().int().positive(),
  openedAt: z.number().int(),
  openedBy: z
    .object({ memberId: z.number().int().positive(), name: z.string() })
    .nullable(),
  scheduleSlot: z.string().nullable(),
  closedAt: z.number().int().nullable(),
  closedBy: z
    .object({ memberId: z.number().int().positive(), name: z.string() })
    .nullable(),
  totalAccounts: z.number().int().nonnegative(),
  completedAccounts: z.number().int().nonnegative(),
  members: z.array(checkinMemberSchema),
  needsAccounts: z.boolean(),
});

/** Check-in record returned by API routes. */
export type Checkin = z.infer<typeof checkinSchema>;

/** Current check-in, or null when no round is open. */
export const currentCheckinResponseSchema = z.object({
  checkin: checkinSchema.nullable(),
});

/** Check-in returned after opening or joining a round. */
export const startCheckinResponseSchema = z.object({
  checkin: checkinSchema,
  joined: z.boolean(),
});

/** Empty request body for a member-started check-in. */
export const startCheckinRequestSchema = z.object({}).strict();

/** Collection of check-ins for the history screen. */
export const checkinsResponseSchema = z.object({
  checkins: z.array(checkinSchema),
});

/** Check-in ID in a route path. */
export const checkinIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

/** Account and check-in IDs for saving one value. */
export const checkinValueParamsSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    accountId: z.coerce.number().int().positive(),
  })
  .strict();

/** A typed amount or request to reuse the prior balance. */
export const saveCheckinValueRequestSchema = z.union([
  z.object({ amount: z.string() }).strict(),
  z.object({ same: z.literal(true) }).strict(),
]);

/** Check-in returned after saving a value or closing it. */
export const checkinResponseSchema = z.object({ checkin: checkinSchema });
