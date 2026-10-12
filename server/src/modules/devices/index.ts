import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import {
  deviceLockSchema,
  deviceSettingsSchema,
  updateDeviceLockRequestSchema,
  updateDeviceRequestSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';

/**
 * Registers the settings of the browser making the request: hiding amounts
 * on Home (UI-HOME-4) and signing in again when reopened (MEM-7).
 */
export const deviceRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;
  const read = (deviceId: string) => {
    const row = database
      .prepare('SELECT hide_home_amounts FROM device WHERE id = ?')
      .get(deviceId) as { hide_home_amounts: bigint } | undefined;
    return deviceSettingsSchema.parse({
      hideHomeAmounts: row === undefined || row.hide_home_amounts !== 0n,
    });
  };

  app.get('/api/devices/current', async (request) =>
    read(request.authContext!.deviceId),
  );

  app.patch('/api/devices/current', async (request, reply) => {
    const parsed = updateDeviceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'validation',
          message: 'Choose whether to hide amounts on Home.',
          fields: { hideHomeAmounts: 'Choose on or off.' },
        },
      });
    }
    const deviceId = request.authContext!.deviceId;
    database
      .prepare('UPDATE device SET hide_home_amounts = ? WHERE id = ?')
      .run(parsed.data.hideHomeAmounts ? 1 : 0, deviceId);
    return read(deviceId);
  });

  const readLock = (deviceId: string) => {
    const row = database
      .prepare('SELECT lock_on_reopen FROM device WHERE id = ?')
      .get(deviceId) as { lock_on_reopen: bigint } | undefined;
    return deviceLockSchema.parse({
      lockOnReopen: row === undefined || row.lock_on_reopen !== 0n,
    });
  };

  app.get('/api/devices/current/lock', async (request) =>
    readLock(request.authContext!.deviceId),
  );

  app.patch('/api/devices/current/lock', async (request, reply) => {
    const parsed = updateDeviceLockRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'validation',
          message: 'Choose whether to sign in again when reopened.',
          fields: { lockOnReopen: 'Choose on or off.' },
        },
      });
    }
    const { deviceId, sessionId } = request.authContext!;
    database.transaction(() => {
      database
        .prepare('UPDATE device SET lock_on_reopen = ? WHERE id = ?')
        .run(parsed.data.lockOnReopen ? 1 : 0, deviceId);
      // The device is in use right now: the switch takes effect from here,
      // not from the last time it said so.
      database
        .prepare('UPDATE session SET foreground_at = ? WHERE id = ?')
        .run(clock.now().getTime(), sessionId);
    })();
    return readLock(deviceId);
  });
};
