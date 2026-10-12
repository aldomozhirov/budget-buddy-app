import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import {
  deviceLockSchema,
  presencePath,
  presenceRequestSchema,
  reopenLockAfterMs,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import {
  isSessionMarkedLocked,
  markSessionLocked,
  sendSessionLocked,
} from '../../plugins/session.js';

/**
 * Registers the presence call (SEC-9). A visible app makes it every 30 s and
 * when it leaves or returns to the foreground; it is the only thing that
 * keeps a session unlocked, so a page or tab that never makes it is locked
 * five minutes after the last one that did.
 *
 * The plugin skips its own lock check here, because this route decides: a
 * session that fell behind (the app was offline in the foreground) is
 * refreshed when the page says it was away for five minutes or less, and is
 * locked for good when the page says it was away for more, or when it was
 * already answered as locked.
 */
export const sessionRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  app.post(
    presencePath,
    { config: { auth: 'session', lockCheck: 'self' } },
    async (request, reply) => {
      const parsed = presenceRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'validation',
            message: 'Say how long the app was away.',
            fields: { awayMs: 'Send a whole number of milliseconds.' },
          },
        });
      }
      const context = request.authContext!;
      const now = clock.now().getTime();

      // A session that was answered as locked, or whose page says it was
      // away for more than five minutes, is locked for good: no later call,
      // whatever it claims, brings it back. Only a sign-in does.
      if (
        context.lockOnReopen &&
        (parsed.data.awayMs > reopenLockAfterMs ||
          isSessionMarkedLocked(database, context.sessionId))
      ) {
        markSessionLocked(database, context.sessionId);
        return sendSessionLocked(reply);
      }

      database
        .prepare('UPDATE session SET foreground_at = ? WHERE id = ?')
        .run(now, context.sessionId);
      return deviceLockSchema.parse({ lockOnReopen: context.lockOnReopen });
    },
  );
};
