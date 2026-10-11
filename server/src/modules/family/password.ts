import type Database from 'better-sqlite3';
import { Algorithm, hash } from '@node-rs/argon2';

/** The one device whose session, passkey and subscription survive a change. */
export type KeptDevice = { sessionId: number; deviceId: string };

/** What a password change removed. */
export type PasswordChangeCounts = {
  sessions: number;
  passkeys: number;
  pushSubscriptions: number;
};

/** Hashes a family password with argon2id; first start and changes share it. */
export function hashFamilyPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

/**
 * Stores a new family password hash and signs the other devices out (MEM-3):
 * the epoch moves on, which also ends the sessions that were not deleted,
 * and the failed-attempt lockout is cleared. Passkeys and push subscriptions
 * of every signed-out device are deleted in the same transaction (D9). With
 * `kept`, that device's session follows the new epoch and its passkey and
 * subscription stay; without it nothing stays (the reset on the host).
 * Runs inside the caller's transaction, or in its own when there is none.
 */
export function replaceFamilyPassword(
  database: Database.Database,
  passwordHash: string,
  kept?: KeptDevice,
): PasswordChangeCounts {
  return database.transaction(() => {
    database
      .prepare(
        'UPDATE family SET password_hash = ?, password_epoch = password_epoch + 1, failed_signins = 0, locked_until = NULL WHERE id = 1',
      )
      .run(passwordHash);
    if (kept) {
      database
        .prepare(
          'UPDATE session SET password_epoch = (SELECT password_epoch FROM family WHERE id = 1) WHERE id = ?',
        )
        .run(kept.sessionId);
    }
    const sessionId = kept?.sessionId ?? -1;
    const deviceId = kept?.deviceId ?? '';
    return {
      sessions: database
        .prepare('DELETE FROM session WHERE id <> ?')
        .run(sessionId).changes,
      passkeys: database
        .prepare('DELETE FROM passkey WHERE device_id <> ?')
        .run(deviceId).changes,
      pushSubscriptions: database
        .prepare('DELETE FROM push_subscription WHERE device_id <> ?')
        .run(deviceId).changes,
    };
  })();
}
