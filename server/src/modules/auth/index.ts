import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import { verify } from '@node-rs/argon2';
import {
  authDeviceResponseSchema,
  profileRequestSchema,
  signInRequestSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { readCookie, setSessionCookies } from '../../plugins/session.js';
import {
  openSession,
  recordFailedSignIn,
  sendFailedSignIn,
  sendLocked,
} from './signIn.js';

/** Registers password sign-in, profile selection, session and sign-out routes. */
export const authRoutes: FastifyPluginAsync<{
  database: Database.Database;
  secureCookies: boolean;
  clock?: Clock;
}> = async (app, options) => {
  const { database, secureCookies } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/auth/device', { config: { auth: 'open' } }, async (request) => {
    const deviceId = readCookie(request.headers.cookie, 'bb_device');
    const device = deviceId
      ? (database
          .prepare(
            `SELECT d.default_member_id,
                      EXISTS (SELECT 1 FROM passkey p WHERE p.device_id = d.id)
                        AS has_passkey
               FROM device d WHERE d.id = ?`,
          )
          .get(deviceId) as
          { default_member_id: bigint | null; has_passkey: bigint } | undefined)
      : undefined;
    const defaultMember = device?.default_member_id
      ? (database
          .prepare('SELECT id, name FROM member WHERE id = ? AND active = 1')
          .get(device.default_member_id) as
          { id: bigint; name: string } | undefined)
      : undefined;
    const response = {
      defaultMember: defaultMember
        ? { id: Number(defaultMember.id), name: defaultMember.name }
        : null,
      hasPasskey: device?.has_passkey === 1n,
    };
    return authDeviceResponseSchema.parse(response);
  });

  app.post(
    '/api/auth/sign-in',
    { config: { auth: 'open' } },
    async (request, reply) => {
      const parsed = signInRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'validation',
            message: 'Enter the family password.',
            fields: { password: 'Enter the family password.' },
          },
        });
      }

      const now = clock.now().getTime();
      const family = database
        .prepare(
          'SELECT password_hash, password_epoch, failed_signins, locked_until FROM family WHERE id = 1',
        )
        .get() as
        | {
            password_hash: string;
            password_epoch: bigint;
            failed_signins: bigint;
            locked_until: bigint | null;
          }
        | undefined;

      if (!family) {
        return reply.code(403).send({
          error: {
            code: 'forbidden_state',
            message: 'First start has not been completed.',
          },
        });
      }

      if (family.locked_until !== null && family.locked_until > BigInt(now)) {
        return sendLocked(reply, Number(family.locked_until), now);
      }

      if (!(await verify(family.password_hash, parsed.data.password))) {
        return sendFailedSignIn(
          reply,
          recordFailedSignIn(database, now),
          now,
          'That password doesn’t match.',
        );
      }

      const opened = openSession(database, {
        deviceCookie: readCookie(request.headers.cookie, 'bb_device'),
        userAgent: request.headers['user-agent'],
        passwordEpoch: family.password_epoch,
        now,
      });
      if (!opened) {
        const lock = database
          .prepare('SELECT locked_until FROM family WHERE id = 1')
          .get() as { locked_until: bigint };
        return sendLocked(reply, Number(lock.locked_until), now);
      }

      setSessionCookies(reply, {
        deviceId: opened.deviceId,
        sessionToken: opened.sessionToken,
        secureCookies,
      });
      return {
        profileRequired: opened.memberId === null,
      };
    },
  );

  app.get('/api/auth/me', { config: { auth: 'session' } }, async (request) => {
    const context = request.authContext!;
    const profiles = database
      .prepare('SELECT id, name FROM member WHERE active = 1 ORDER BY id')
      .all() as Array<{ id: bigint; name: string }>;
    return {
      member:
        context.memberId === null
          ? null
          : { id: context.memberId, name: context.memberName! },
      profiles: profiles.map(({ id, name }) => ({ id: Number(id), name })),
      device: {
        defaultMemberId: context.defaultMemberId,
        hasPasskey: context.hasPasskey,
        lockOnReopen: context.lockOnReopen,
      },
    };
  });

  app.post(
    '/api/auth/profile',
    { config: { auth: 'session' } },
    async (request, reply) => {
      const parsed = profileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'validation',
            message: 'Choose an active profile.',
            fields: { memberId: 'Choose an active profile.' },
          },
        });
      }

      const selected = database
        .prepare('SELECT id, name FROM member WHERE id = ? AND active = 1')
        .get(parsed.data.memberId) as { id: bigint; name: string } | undefined;
      if (!selected) {
        return reply.code(403).send({
          error: {
            code: 'forbidden_state',
            message: 'That profile is no longer active.',
          },
        });
      }

      const context = request.authContext!;
      const defaultMemberId = parsed.data.remember ? Number(selected.id) : null;
      database.transaction(() => {
        database
          .prepare('UPDATE session SET member_id = ? WHERE id = ?')
          .run(selected.id, context.sessionId);
        database
          .prepare('UPDATE device SET default_member_id = ? WHERE id = ?')
          .run(defaultMemberId, context.deviceId);
        // Pushes follow the profile this device is used as (Design section 4).
        database
          .prepare(
            'UPDATE push_subscription SET member_id = ? WHERE device_id = ?',
          )
          .run(selected.id, context.deviceId);
      })();

      return {
        member: { id: Number(selected.id), name: selected.name },
        defaultMemberId,
      };
    },
  );

  app.post(
    '/api/auth/sign-out',
    { config: { auth: 'profile' } },
    async (request, reply) => {
      database
        .prepare('DELETE FROM session WHERE id = ?')
        .run(request.authContext!.sessionId);
      reply.header(
        'Set-Cookie',
        `bb_session=; Path=/; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}; Max-Age=0`,
      );
      return { signedOut: true };
    },
  );
};
