import { z } from 'zod';

/** Public VAPID key a browser needs to subscribe to this server's pushes. */
export const pushKeyResponseSchema = z.object({
  publicKey: z.string().min(1),
});

/** Public VAPID key response. */
export type PushKeyResponse = z.infer<typeof pushKeyResponseSchema>;

/**
 * A browser's `PushSubscription.toJSON()`, as sent to opt in. Push services
 * only deliver to `https:` endpoints.
 */
export const pushSubscriptionRequestSchema = z.object({
  endpoint: z
    .url({ protocol: /^https$/u })
    .max(2048, 'The subscription address is too long.'),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

/** Opt-in request body. */
export type PushSubscriptionRequest = z.infer<
  typeof pushSubscriptionRequestSchema
>;

/** Answer to reading, opting this device in, or opting it out. */
export const pushSubscriptionResponseSchema = z.object({
  subscribed: z.boolean(),
});

/** Subscription state answer. */
export type PushSubscriptionResponse = z.infer<
  typeof pushSubscriptionResponseSchema
>;
