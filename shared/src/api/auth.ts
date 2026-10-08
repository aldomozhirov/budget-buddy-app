import { z } from 'zod';

/** Validates the family-password sign-in request. */
export const signInRequestSchema = z
  .object({ password: z.string().min(1) })
  .strict();

/** Validates the profile selection and whether to remember it on this device. */
export const profileRequestSchema = z
  .object({ memberId: z.number().int().positive(), remember: z.boolean() })
  .strict();

/** Validates the public profile data returned by the authentication API. */
export const authMemberSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});

/** Profile returned by authentication endpoints. */
export type AuthMember = z.infer<typeof authMemberSchema>;

/** Validates sign-in hints available to this browser before authentication. */
export const authDeviceResponseSchema = z.object({
  defaultMember: authMemberSchema.nullable(),
  hasPasskey: z.boolean(),
});

/** Default profile and passkey availability for the current browser. */
export type AuthDeviceResponse = z.infer<typeof authDeviceResponseSchema>;

/** Validates the current session and device information. */
export const authMeResponseSchema = z.object({
  member: authMemberSchema.nullable(),
  profiles: z.array(authMemberSchema),
  device: z.object({
    defaultMemberId: z.number().int().positive().nullable(),
    hasPasskey: z.boolean(),
  }),
});

/** Current authenticated profile, available profiles and device preferences. */
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

/** Validates a successful profile selection response. */
export const profileResponseSchema = z.object({
  member: authMemberSchema,
  defaultMemberId: z.number().int().positive().nullable(),
});

/** Result of selecting the active profile on this session. */
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/** Validates a successful sign-in response. */
export const signInResponseSchema = z.object({
  profileRequired: z.boolean(),
});

/** Result returned after the family password is accepted. */
export type SignInResponse = z.infer<typeof signInResponseSchema>;
