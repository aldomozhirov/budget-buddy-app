import type Database from 'better-sqlite3';

/** IDs of all active members, in ascending order (NTF-2). */
export function activeMemberIds(database: Database.Database): number[] {
  return (
    database
      .prepare('SELECT id FROM member WHERE active = 1 ORDER BY id')
      .all() as Array<{ id: bigint }>
  ).map(({ id }) => Number(id));
}

/** Name of a member, active or not; null when there is no such member. */
export function memberName(
  database: Database.Database,
  memberId: number | null,
): string | null {
  if (memberId === null) return null;
  const row = database
    .prepare('SELECT name FROM member WHERE id = ?')
    .get(memberId) as { name: string } | undefined;
  return row?.name ?? null;
}

/**
 * IDs of the active members who own an active account with no value in the
 * check-in, in ascending order; none once it is closed or if it is unknown
 * (CHK-3). Accounts nobody owns, and accounts of inactive members, remind
 * no one.
 */
export function membersWithAccountsLeft(
  database: Database.Database,
  checkinId: number,
): number[] {
  return (
    database
      .prepare(
        `SELECT m.id FROM member m
         WHERE m.active = 1
           AND EXISTS (SELECT 1 FROM checkin c
                       WHERE c.id = ? AND c.closed_at IS NULL)
           AND EXISTS (
             SELECT 1 FROM account a
             WHERE a.owner_member_id = m.id AND a.active = 1
               AND NOT EXISTS (SELECT 1 FROM snapshot s
                               WHERE s.account_id = a.id AND s.checkin_id = ?))
         ORDER BY m.id`,
      )
      .all(checkinId, checkinId) as Array<{ id: bigint }>
  ).map(({ id }) => Number(id));
}

/**
 * True when the check-in is open and every active account has a value in it,
 * with at least one account: the state in which only "Close now" is left
 * (CHK-8, CHK-3). It counts the same accounts as the check-in screen, so an
 * account nobody owns or an inactive member owns also keeps it incomplete.
 */
export function hasEveryValue(
  database: Database.Database,
  checkinId: number,
): boolean {
  const row = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM account WHERE active = 1) AS accounts,
         (SELECT COUNT(*) FROM account a
          WHERE a.active = 1
            AND NOT EXISTS (SELECT 1 FROM snapshot s
                            WHERE s.account_id = a.id AND s.checkin_id = ?))
           AS missing
       WHERE EXISTS (SELECT 1 FROM checkin c
                     WHERE c.id = ? AND c.closed_at IS NULL)`,
    )
    .get(checkinId, checkinId) as
    { accounts: bigint; missing: bigint } | undefined;
  return row !== undefined && row.accounts > 0n && row.missing === 0n;
}
