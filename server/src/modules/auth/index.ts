import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { verify } from '@node-rs/argon2';
import {
  authDeviceResponseSchema,
  profileRequestSchema,
  signInRequestSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { readCookie, setSessionCookies } from '../../plugins/session.js';

const sessionLifetimeMs = 90 * 24 * 60 * 60 * 1000;
const lockDurationMs = 30_000;

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
        const failure = recordFailedSignIn(database, now);
        if (failure.lockedUntil !== null) {
          return sendLocked(reply, failure.lockedUntil, now);
        }
        const triesLeft = 3 - failure.failedSignins;
        const noun = triesLeft === 1 ? 'try' : 'tries';
        return reply.code(401).send({
          error: {
            code: 'unauthenticated',
            message: `That password doesn’t match. ${triesLeft} ${noun} before a short wait.`,
            triesLeft,
          },
        });
      }

      const deviceCookie = readCookie(request.headers.cookie, 'bb_device');
      const deviceId = randomBytes(16).toString('hex');
      const sessionToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
      const userAgent = request.headers['user-agent'] ?? null;

      const memberId = database.transaction(() => {
        const currentFamily = database
          .prepare('SELECT locked_until FROM family WHERE id = 1')
          .get() as { locked_until: bigint | null };
        if (
          currentFamily.locked_until !== null &&
          currentFamily.locked_until > BigInt(now)
        ) {
          return undefined;
        }

        database
          .prepare(
            'UPDATE family SET failed_signins = 0, locked_until = NULL WHERE id = 1',
          )
          .run();

        const existingDevice = deviceCookie
          ? (database
              .prepare('SELECT id, default_member_id FROM device WHERE id = ?')
              .get(deviceCookie) as
              { id: string; default_member_id: bigint | null } | undefined)
          : undefined;
        const selectedDeviceId = existingDevice?.id ?? deviceId;
        let defaultMemberId = existingDevice?.default_member_id ?? null;
        if (defaultMemberId !== null) {
          const activeMember = database
            .prepare('SELECT id FROM member WHERE id = ? AND active = 1')
            .get(defaultMemberId);
          if (!activeMember) {
            defaultMemberId = null;
            database
              .prepare(
                'UPDATE device SET default_member_id = NULL WHERE id = ?',
              )
              .run(selectedDeviceId);
          }
        }

        if (existingDevice) {
          database
            .prepare(
              'UPDATE device SET label = ?, last_seen_at = ? WHERE id = ?',
            )
            .run(userAgent, now, selectedDeviceId);
        } else {
          database
            .prepare(
              'INSERT INTO device (id, default_member_id, label, created_at, last_seen_at) VALUES (?, NULL, ?, ?, ?)',
            )
            .run(selectedDeviceId, userAgent, now, now);
        }

        database
          .prepare(
            'INSERT INTO session (token_hash, device_id, member_id, password_epoch, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            tokenHash,
            selectedDeviceId,
            defaultMemberId,
            family.password_epoch,
            now,
            now,
            now + sessionLifetimeMs,
          );
        return defaultMemberId === null ? null : Number(defaultMemberId);
      })();

      if (memberId === undefined) {
        const activeLock = database
          .prepare('SELECT locked_until FROM family WHERE id = 1')
          .get() as { locked_until: bigint | null };
        return sendLocked(reply, Number(activeLock.locked_until), now);
      }

      const selectedDeviceId = deviceCookie
        ? ((
            database
              .prepare('SELECT id FROM device WHERE id = ?')
              .get(deviceCookie) as { id: string } | undefined
          )?.id ?? deviceId)
        : deviceId;
      setSessionCookies(reply, {
        deviceId: selectedDeviceId,
        sessionToken,
        secureCookies,
      });
      return {
        profileRequired: memberId === null,
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

function recordFailedSignIn(
  database: Database.Database,
  now: number,
): { failedSignins: number; lockedUntil: number | null } {
  return database.transaction(() => {
    const family = database
      .prepare('SELECT failed_signins, locked_until FROM family WHERE id = 1')
      .get() as { failed_signins: bigint; locked_until: bigint | null };
    if (family.locked_until !== null && family.locked_until > BigInt(now)) {
      return {
        failedSignins: Number(family.failed_signins),
        lockedUntil: Number(family.locked_until),
      };
    }

    const previousFailures =
      family.locked_until !== null && family.locked_until <= BigInt(now)
        ? 0
        : Number(family.failed_signins);
    const failedSignins = previousFailures + 1;
    const lockedUntil = failedSignins >= 3 ? now + lockDurationMs : null;
    database
      .prepare(
        'UPDATE family SET failed_signins = ?, locked_until = ? WHERE id = 1',
      )
      .run(lockedUntil === null ? failedSignins : 3, lockedUntil);
    return { failedSignins, lockedUntil };
  })();
}

function sendLocked(reply: FastifyReply, lockedUntil: number, now: number) {
  const retryAfter = Math.max(1, Math.ceil((lockedUntil - now) / 1000));
  return reply.code(423).send({
    error: {
      code: 'locked',
      message: `Too many tries. Try again in ${retryAfter} s.`,
      retryAfter,
      triesLeft: 0,
    },
  });
}
