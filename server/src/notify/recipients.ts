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
