import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import {
  pushKeyResponseSchema,
  pushSubscriptionRequestSchema,
  pushSubscriptionResponseSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';

/**
 * Registers the Web Push opt-in routes (NTF-2): the public key, and putting
 * or removing this device's subscription under the profile in use. Sending is
 * the notifier's job (`notify/notifier.ts`).
 */
export const pushRoutes: FastifyPluginAsync<{
  database: Database.Database;
  publicKey: string;
  clock?: Clock;
}> = async (app, { database, publicKey, clock = systemClock }) => {
  app.get('/api/push/key', async () =>
    pushKeyResponseSchema.parse({ publicKey }),
  );

  app.put('/api/push/subscription', async (request, reply) => {
    const parsed = pushSubscriptionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'validation',
          message: 'That is not a valid push subscription.',
        },
      });
    }
    const { endpoint, keys } = parsed.data;
    const { deviceId, memberId } = request.authContext!;
    // The same endpoint again (a re-opt-in, or another profile on this
    // device) updates the row instead of adding one.
    database
      .prepare(
        `INSERT INTO push_subscription
           (device_id, member_id, endpoint, p256dh, auth, created_at, failures)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT (endpoint) DO UPDATE SET
           device_id = excluded.device_id, member_id = excluded.member_id,
           p256dh = excluded.p256dh, auth = excluded.auth, failures = 0`,
      )
      .run(
        deviceId,
        memberId,
        endpoint,
        keys.p256dh,
        keys.auth,
        clock.now().getTime(),
      );
    return pushSubscriptionResponseSchema.parse({ subscribed: true });
  });

  app.delete('/api/push/subscription', async (request) => {
    database
      .prepare('DELETE FROM push_subscription WHERE device_id = ?')
      .run(request.authContext!.deviceId);
    return pushSubscriptionResponseSchema.parse({ subscribed: false });
  });
};
