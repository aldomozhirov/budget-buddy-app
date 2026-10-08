import { z } from 'zod';

const memberNameSchema = z.string().trim().min(1, 'Enter a profile name.');

/** Validates an active or inactive profile returned by member management. */
export const managedMemberSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  active: z.boolean(),
});

/** Profile data used by the Settings profile list. */
export type ManagedMember = z.infer<typeof managedMemberSchema>;

/** Validates the full profile list, including profiles that can be reactivated. */
export const membersResponseSchema = z.object({
  members: z.array(managedMemberSchema),
});

/** Profile list returned by member management. */
export type MembersResponse = z.infer<typeof membersResponseSchema>;

/** Validates a request to add a profile. */
export const createMemberRequestSchema = z
  .object({ name: memberNameSchema })
  .strict();

/** Validates a profile rename, deactivation or reactivation request. */
export const updateMemberRequestSchema = z
  .object({
    name: memberNameSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.active !== undefined);

/** Validates a member ID from a profile-management URL. */
export const memberIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

/** Validates a successful add or update profile response. */
export const memberResponseSchema = z.object({
  member: managedMemberSchema,
});

/** Result returned after a profile is added or updated. */
export type MemberResponse = z.infer<typeof memberResponseSchema>;
