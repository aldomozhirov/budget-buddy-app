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
