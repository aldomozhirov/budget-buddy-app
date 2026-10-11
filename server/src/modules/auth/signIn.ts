import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyReply } from 'fastify';

const sessionLifetimeMs = 90 * 24 * 60 * 60 * 1000;
const lockDurationMs = 30_000;

/**
 * Counts one failed sign-in toward the family-wide lockout: the third in a
 * row locks sign-in for 30 s (SEC-2). Password and passkey failures share it.
 * @returns The running count, and the lock's end when this failure set one.
 */
export function recordFailedSignIn(
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

/** The end of the sign-in lock (ms since the epoch) while one is active. */
export function activeLockEnd(
  database: Database.Database,
  now: number,
): number | null {
  const family = database
    .prepare('SELECT locked_until FROM family WHERE id = 1')
    .get() as { locked_until: bigint | null } | undefined;
  return family?.locked_until != null && family.locked_until > BigInt(now)
    ? Number(family.locked_until)
    : null;
}

/** Answers 423 with the seconds left, as the sign-in screen reads it. */
export function sendLocked(
  reply: FastifyReply,
  lockedUntil: number,
  now: number,
) {
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

/** Answers 401 for a failed attempt, or 423 when it started the lock. */
export function sendFailedSignIn(
  reply: FastifyReply,
  failure: { failedSignins: number; lockedUntil: number | null },
  now: number,
  what: string,
) {
  if (failure.lockedUntil !== null) {
    return sendLocked(reply, failure.lockedUntil, now);
  }
  const triesLeft = 3 - failure.failedSignins;
  const noun = triesLeft === 1 ? 'try' : 'tries';
  return reply.code(401).send({
    error: {
      code: 'unauthenticated',
      message: `${what} ${triesLeft} ${noun} before a short wait.`,
      triesLeft,
    },
  });
}

/** A session opened by `openSession`, ready for its cookies. */
export type OpenedSession = {
  deviceId: string;
  sessionToken: string;
  /** The profile the device opens as; null when the member must pick one. */
  memberId: number | null;
};

/**
 * Opens a session after a proven sign-in, the same way for a password and a
 * passkey: clears the failure count, finds or creates the device, drops a
 * default profile that is no longer active and inserts the session with the
 * family's current password epoch.
 * @param deviceCookie The `bb_device` value, which names the device if known.
 * @returns The session, or undefined when a lock began in the meantime.
 */
export function openSession(
  database: Database.Database,
  options: {
    deviceCookie: string | undefined;
    userAgent: string | undefined;
    passwordEpoch: bigint;
    now: number;
  },
): OpenedSession | undefined {
  const { deviceCookie, now } = options;
  const sessionToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(sessionToken).digest('hex');

  return database.transaction(() => {
    if (activeLockEnd(database, now) !== null) return undefined;
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
    const deviceId = existingDevice?.id ?? randomBytes(16).toString('hex');
    let defaultMemberId = existingDevice?.default_member_id ?? null;
    if (defaultMemberId !== null) {
      const activeMember = database
        .prepare('SELECT id FROM member WHERE id = ? AND active = 1')
        .get(defaultMemberId);
      if (!activeMember) {
        defaultMemberId = null;
        database
          .prepare('UPDATE device SET default_member_id = NULL WHERE id = ?')
          .run(deviceId);
      }
    }

    if (existingDevice) {
      database
        .prepare('UPDATE device SET label = ?, last_seen_at = ? WHERE id = ?')
        .run(options.userAgent ?? null, now, deviceId);
    } else {
      database
        .prepare(
          'INSERT INTO device (id, default_member_id, label, created_at, last_seen_at) VALUES (?, NULL, ?, ?, ?)',
        )
        .run(deviceId, options.userAgent ?? null, now, now);
    }

    database
      .prepare(
        'INSERT INTO session (token_hash, device_id, member_id, password_epoch, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        tokenHash,
        deviceId,
        defaultMemberId,
        options.passwordEpoch,
        now,
        now,
        now + sessionLifetimeMs,
      );
    return {
      deviceId,
      sessionToken,
      memberId: defaultMemberId === null ? null : Number(defaultMemberId),
    };
  })();
}
