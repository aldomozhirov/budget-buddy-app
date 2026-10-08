import { z } from 'zod';

/** Validates a signed-in request to replace the shared family password. */
export const changeFamilyPasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter the current password.'),
    newPassword: z.string().min(10, 'Use at least 10 characters.'),
  })
  .strict();

/** Validates confirmation that the family password was changed. */
export const changeFamilyPasswordResponseSchema = z.object({
  changed: z.literal(true),
});

/** Result returned after the family password is changed. */
export type ChangeFamilyPasswordResponse = z.infer<
  typeof changeFamilyPasswordResponseSchema
>;
