import Database from 'better-sqlite3';
import { changeFamilyPasswordRequestSchema } from '@budget-buddy/shared';
import {
  hashFamilyPassword,
  replaceFamilyPassword,
  type PasswordChangeCounts,
} from '../modules/family/password.js';

/** How long a write waits for the running server's own write to finish. */
const busyTimeoutMs = 15_000;

/** A failure with a message that is meant for the person at the terminal. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

/** Why a candidate password is refused, or `undefined` when it is fine. */
export function passwordProblem(password: string): string | undefined {
  const result =
    changeFamilyPasswordRequestSchema.shape.newPassword.safeParse(password);
  return result.success ? undefined : result.error.issues[0]?.message;
}

/**
 * Sets a new family password straight in the database (UI-AUTH-4), for when
 * nobody is signed in to change it in Settings. It ends every session, so
 * every device must sign in again with the new password; deletes all
 * passkeys and all push subscriptions, since no device is kept; and clears
 * the sign-in lockout. Profiles, data and devices' default profiles stay.
 *
 * It opens the file the running server uses, with SQLite's busy wait, and
 * writes in one immediate transaction, so it is safe with the server up and
 * never leaves a half-done reset. It does not migrate the database.
 * @param databasePath The `budget-buddy.sqlite` file.
 * @throws {CliError} with a plain reason when the password is too short, the
 *   file is missing or the app has not finished first start.
 */
export async function resetFamilyPassword(
  databasePath: string,
  password: string,
): Promise<PasswordChangeCounts> {
  const problem = passwordProblem(password);
  if (problem) throw new CliError(problem);

  let database: Database.Database;
  try {
    database = new Database(databasePath, {
      fileMustExist: true,
      timeout: busyTimeoutMs,
    });
  } catch {
    throw new CliError(
      `There is no database at ${databasePath}. Check DATA_DIR, and run the app once first.`,
    );
  }
  try {
    // Hashed before the write lock is taken: argon2 takes a moment.
    const passwordHash = await hashFamilyPassword(password);
    return database
      .transaction(() => {
        const family = database
          .prepare('SELECT 1 FROM family WHERE id = 1')
          .get();
        if (!family) {
          throw new CliError(
            'There is no family password yet. Open the app and finish first start instead.',
          );
        }
        return replaceFamilyPassword(database, passwordHash);
      })
      .immediate();
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (
      error instanceof Error &&
      /no such (table|column)/u.test(error.message)
    ) {
      throw new CliError(
        'The database is from an older version. Start the app once so it updates, then run this again.',
      );
    }
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_BUSY'
    ) {
      throw new CliError(
        'The database stayed busy for 15 seconds. Run this again in a moment.',
      );
    }
    throw error;
  } finally {
    database.close();
  }
}
