import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import {
  deviceSettingsSchema,
  updateDeviceRequestSchema,
} from '@budget-buddy/shared';

/** Registers the settings of the browser making the request (UI-HOME-4). */
export const deviceRoutes: FastifyPluginAsync<{
  database: Database.Database;
}> = async (app, { database }) => {
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
};
