import { z } from 'zod';

const base64url = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/u, 'Expected base64url text.');

/** The browser's answer to `navigator.credentials.create()`, as JSON. */
export const passkeyRegistrationResponseSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(z.string().max(32)).max(8).optional(),
  }),
  authenticatorAttachment: z.string().max(32).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

/** The browser's answer to `navigator.credentials.get()`, as JSON. */
export const passkeyAuthenticationResponseSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
  authenticatorAttachment: z.string().max(32).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

/** Body that finishes turning Face ID on for this device. */
export const passkeyRegisterVerifyRequestSchema = z
  .object({ response: passkeyRegistrationResponseSchema })
  .strict();

/** Body that finishes signing in with Face ID. */
export const passkeyAuthenticateVerifyRequestSchema = z
  .object({ response: passkeyAuthenticationResponseSchema })
  .strict();

/**
 * Options for `startRegistration()` / `startAuthentication()`. Only the
 * fields the app reads are checked; the rest is the library's JSON, passed
 * to the browser unchanged.
 */
export const passkeyOptionsResponseSchema = z.looseObject({
  challenge: base64url,
  rpId: z.string().min(1).optional(),
});

/** Whether this device holds a passkey, after turning it on or off. */
export const passkeyStateResponseSchema = z.object({
  hasPasskey: z.boolean(),
});

/** Answer to registering or removing this device's passkey. */
export type PasskeyStateResponse = z.infer<typeof passkeyStateResponseSchema>;
