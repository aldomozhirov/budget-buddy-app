import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import {
  pushKeyResponseSchema,
  pushSubscriptionRequestSchema,
  pushSubscriptionResponseSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { isAllowedPushEndpoint } from './endpoints.js';

/**
 * Registers the Web Push opt-in routes (NTF-2): the public key, and putting
 * reading, putting or removing this device's subscription under the profile in
 * use. Sending is the notifier's job (`notify/notifier.ts`).
 */
export const pushRoutes: FastifyPluginAsync<{
  database: Database.Database;
  publicKey: string;
  /** Hosts a subscription's endpoint may name (SEC-8). */
  allowedHosts: readonly string[];
  clock?: Clock;
}> = async (
  app,
  { database, publicKey, allowedHosts, clock = systemClock },
) => {
  app.get('/api/push/key', async () =>
    pushKeyResponseSchema.parse({ publicKey }),
  );

  // Lets a device that still holds a browser subscription learn that the
  // server dropped its row (a family password change, D9) and show Off.
  app.get('/api/push/subscription', async (request) => {
    const row = database
      .prepare('SELECT 1 FROM push_subscription WHERE device_id = ?')
      .get(request.authContext!.deviceId);
    return pushSubscriptionResponseSchema.parse({
      subscribed: row !== undefined,
    });
  });

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
    if (!isAllowedPushEndpoint(endpoint, allowedHosts)) {
      return reply.code(400).send({
        error: {
          code: 'validation',
          message: 'This push service is not allowed.',
          fields: { endpoint: 'This push service is not allowed.' },
        },
      });
    }
    const { deviceId, memberId } = request.authContext!;
    database.transaction(() => {
      // One subscription per device: a new endpoint replaces the old one,
      // which the push service would only report gone much later.
      database
        .prepare(
          'DELETE FROM push_subscription WHERE device_id = ? AND endpoint != ?',
        )
        .run(deviceId, endpoint);
      // The same endpoint again (a re-opt-in, or another profile on this
      // device) updates the row instead of adding one.
      database
        .prepare(
          `INSERT INTO push_subscription
             (device_id, member_id, endpoint, p256dh, auth, created_at,
              failures)
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
    })();
    return pushSubscriptionResponseSchema.parse({ subscribed: true });
  });

  app.delete('/api/push/subscription', async (request) => {
    database
      .prepare('DELETE FROM push_subscription WHERE device_id = ?')
      .run(request.authContext!.deviceId);
    return pushSubscriptionResponseSchema.parse({ subscribed: false });
  });
};
