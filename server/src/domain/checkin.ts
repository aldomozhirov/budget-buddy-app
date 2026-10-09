import type Database from 'better-sqlite3';
import { toMinorString } from '@budget-buddy/shared';
import type { Checkin } from '@budget-buddy/shared';
import type { CheckinEventBus } from '../events.js';

const snapshotSourceOrder = `CASE s.source
  WHEN 'connector' THEN 0 WHEN 'statement' THEN 1 WHEN 'photo' THEN 2
  WHEN 'checkin' THEN 3 WHEN 'manual' THEN 4 WHEN 'opening' THEN 5
  WHEN 'carried_forward' THEN 6 ELSE 7
END`;

type CheckinRow = {
  id: bigint;
  opened_at: bigint;
  opened_by: bigint | null;
  opened_by_name: string | null;
  schedule_slot: string | null;
  closed_at: bigint | null;
  closed_by: bigint | null;
  closed_by_name: string | null;
};

type AccountRow = {
  account_id: bigint;
  account_name: string;
  currency: string;
  owner_member_id: bigint | null;
  owner_name: string | null;
  owner_active: bigint | null;
  previous_amount: bigint | null;
  previous_taken_at: bigint | null;
  previous_source: string | null;
  snapshot_id: bigint | null;
  value_amount: bigint | null;
  value_taken_at: bigint | null;
  value_source: string | null;
};

type CheckinAccount = Checkin['members'][number]['accountList'][number];
type CheckinValue = NonNullable<CheckinAccount['value']>;

/** Outcome of creating a round or joining the already-open round. */
export interface StartCheckinResult {
  checkinId: number;
  joined: boolean;
}

/** Opens a round, or joins the existing one, and publishes its open event. */
export function startCheckin(
  database: Database.Database,
  options: {
    openedBy: number | null;
    scheduleSlot?: string | null;
    now: number;
    events: CheckinEventBus;
  },
): StartCheckinResult {
  const result = database.transaction(() => {
    if (options.scheduleSlot) {
      const scheduled = database
        .prepare('SELECT id FROM checkin WHERE schedule_slot = ?')
        .get(options.scheduleSlot) as { id: bigint } | undefined;
      if (scheduled) return { checkinId: Number(scheduled.id), joined: true };
    }
    const open = database
      .prepare('SELECT id FROM checkin WHERE closed_at IS NULL')
      .get() as { id: bigint } | undefined;
    if (open) return { checkinId: Number(open.id), joined: true };

    const inserted = database
      .prepare(
        'INSERT INTO checkin (opened_at, opened_by, schedule_slot) VALUES (?, ?, ?)',
      )
      .run(options.now, options.openedBy, options.scheduleSlot ?? null);
    return { checkinId: Number(inserted.lastInsertRowid), joined: false };
  })();

  if (!result.joined) {
    options.events.emit('checkin.opened', {
      checkinId: result.checkinId,
      openedAt: options.now,
      openedBy: options.openedBy,
      scheduleSlot: options.scheduleSlot ?? null,
    });
  }
  return result;
}

/** Returns a check-in and its current or historical account progress. */
export function getCheckin(
  database: Database.Database,
  checkinId: number,
  memberId: number,
  now: number,
): Checkin | undefined {
  const checkin = database
    .prepare(
      `SELECT c.id, c.opened_at, c.opened_by, opened.name AS opened_by_name,
              c.schedule_slot, c.closed_at, c.closed_by,
              closed.name AS closed_by_name
       FROM checkin c
       LEFT JOIN member opened ON opened.id = c.opened_by
       LEFT JOIN member closed ON closed.id = c.closed_by
       WHERE c.id = ?`,
    )
    .get(checkinId) as CheckinRow | undefined;
  if (!checkin) return undefined;

  const closedAt =
    checkin.closed_at === null ? null : Number(checkin.closed_at);
  const cutoff = closedAt ?? now;
  const accounts = database
    .prepare(
      `SELECT a.id AS account_id, a.name AS account_name, a.currency,
              a.owner_member_id, owner.name AS owner_name,
              owner.active AS owner_active,
              previous.amount AS previous_amount,
              previous.taken_at AS previous_taken_at,
              previous.source AS previous_source,
              value.id AS snapshot_id, value.amount AS value_amount,
              value.taken_at AS value_taken_at, value.source AS value_source
       FROM account a
       LEFT JOIN member owner ON owner.id = a.owner_member_id
       LEFT JOIN snapshot value
         ON value.account_id = a.id AND value.checkin_id = ?
       LEFT JOIN snapshot previous
         ON previous.id = (
           SELECT s.id FROM snapshot s
           WHERE s.account_id = a.id
             AND s.checkin_id IS NOT ?
             AND s.taken_at <= ?
            ORDER BY s.taken_at DESC, ${snapshotSourceOrder}, s.id DESC
           LIMIT 1
         )
       WHERE a.created_at <= ?
         AND CASE WHEN ? IS NULL THEN a.active = 1
                  ELSE (a.deactivated_at IS NULL OR a.deactivated_at > ?) END
       ORDER BY COALESCE(owner.name, '') COLLATE NOCASE,
                a.name COLLATE NOCASE, a.id`,
    )
    .all(
      checkinId,
      checkinId,
      cutoff,
      cutoff,
      closedAt,
      closedAt,
    ) as AccountRow[];

  const grouped = new Map<string, Checkin['members'][number]>();
  const memberRows = database
    .prepare('SELECT id, name, active FROM member ORDER BY id')
    .all() as Array<{ id: bigint; name: string; active: bigint }>;
  for (const member of memberRows) {
    grouped.set(member.id.toString(), {
      memberId: Number(member.id),
      name: member.name,
      active: member.active === 1n,
      accounts: 0,
      completed: 0,
      done: true,
      accountList: [],
    });
  }
  for (const account of accounts) {
    const memberKey = account.owner_member_id?.toString() ?? 'unassigned';
    let member = grouped.get(memberKey);
    if (!member) {
      member = {
        memberId:
          account.owner_member_id === null
            ? null
            : Number(account.owner_member_id),
        name: account.owner_name,
        active:
          account.owner_active === null ? null : account.owner_active === 1n,
        accounts: 0,
        completed: 0,
        done: false,
        accountList: [],
      };
      grouped.set(memberKey, member);
    }
    const hasValue = account.snapshot_id !== null;
    member.accounts += 1;
    if (hasValue) member.completed += 1;
    member.accountList.push({
      id: Number(account.account_id),
      name: account.account_name,
      currency: account.currency,
      balance: toMinorString(account.previous_amount ?? 0n),
      balanceTakenAt:
        account.previous_taken_at === null
          ? null
          : Number(account.previous_taken_at),
      balanceSource: account.previous_source as CheckinAccount['balanceSource'],
      value:
        account.snapshot_id === null
          ? null
          : {
              snapshotId: Number(account.snapshot_id),
              amount: toMinorString(account.value_amount ?? 0n),
              source: account.value_source as CheckinValue['source'],
              takenAt: Number(account.value_taken_at ?? 0n),
            },
    });
  }
  const members = [...grouped.values()];
  for (const member of members)
    member.done = member.completed === member.accounts;
  const totalAccounts = accounts.length;
  const completedAccounts = accounts.filter(
    (account) => account.snapshot_id !== null,
  ).length;
  const currentMember = members.find((member) => member.memberId === memberId);

  return {
    id: Number(checkin.id),
    openedAt: Number(checkin.opened_at),
    openedBy:
      checkin.opened_by === null
        ? null
        : {
            memberId: Number(checkin.opened_by),
            name: checkin.opened_by_name ?? '',
          },
    scheduleSlot: checkin.schedule_slot,
    closedAt,
    closedBy:
      checkin.closed_by === null
        ? null
        : {
            memberId: Number(checkin.closed_by),
            name: checkin.closed_by_name ?? '',
          },
    totalAccounts,
    completedAccounts,
    members,
    needsAccounts: !currentMember || currentMember.accounts === 0,
  };
}

/** Saves one check-in value, writing a revision when it replaces a value. */
export function saveCheckinValue(
  database: Database.Database,
  options: {
    checkinId: number;
    accountId: number;
    memberId: number;
    amount: bigint | 'same';
    now: number;
    events: CheckinEventBus;
  },
): 'not_found' | 'closed' | 'inactive_account' | 'saved' {
  let closedEvent: CheckinEventsClosed | undefined;
  const result = database.transaction(() => {
    const checkin = database
      .prepare('SELECT closed_at FROM checkin WHERE id = ?')
      .get(options.checkinId) as { closed_at: bigint | null } | undefined;
    if (!checkin) return 'not_found' as const;
    if (checkin.closed_at !== null) return 'closed' as const;
    const account = database
      .prepare('SELECT id FROM account WHERE id = ? AND active = 1')
      .get(options.accountId);
    if (!account) return 'inactive_account' as const;

    const existing = database
      .prepare(
        'SELECT id, amount, taken_at FROM snapshot WHERE checkin_id = ? AND account_id = ?',
      )
      .get(options.checkinId, options.accountId) as
      { id: bigint; amount: bigint; taken_at: bigint } | undefined;
    const amount =
      options.amount === 'same'
        ? previousBalance(
            database,
            options.accountId,
            options.checkinId,
            options.now,
          ).amount
        : options.amount;

    if (existing) {
      database
        .prepare(
          `INSERT INTO snapshot_revision
             (snapshot_id, account_id, action, old_amount, old_taken_at,
              changed_by, changed_at)
           VALUES (?, ?, 'update', ?, ?, ?, ?)`,
        )
        .run(
          existing.id,
          options.accountId,
          existing.amount,
          existing.taken_at,
          options.memberId,
          options.now,
        );
      database
        .prepare(
          'UPDATE snapshot SET amount = ?, taken_at = ?, updated_by = ?, updated_at = ? WHERE id = ?',
        )
        .run(amount, options.now, options.memberId, options.now, existing.id);
    } else {
      database
        .prepare(
          `INSERT INTO snapshot
             (account_id, taken_at, amount, source, checkin_id, created_by,
              created_at, updated_by, updated_at)
           VALUES (?, ?, ?, 'checkin', ?, ?, ?, ?, ?)`,
        )
        .run(
          options.accountId,
          options.now,
          amount,
          options.checkinId,
          options.memberId,
          options.now,
          options.memberId,
          options.now,
        );
    }

    const unfinished = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM account a
         LEFT JOIN snapshot s
           ON s.account_id = a.id AND s.checkin_id = ?
         WHERE a.active = 1 AND s.id IS NULL`,
      )
      .get(options.checkinId) as { count: bigint };
    const active = database
      .prepare('SELECT COUNT(*) AS count FROM account WHERE active = 1')
      .get() as { count: bigint };
    if (active.count > 0n && unfinished.count === 0n) {
      database
        .prepare(
          'UPDATE checkin SET closed_at = ?, closed_by = NULL WHERE id = ?',
        )
        .run(options.now, options.checkinId);
      closedEvent = {
        checkinId: options.checkinId,
        closedAt: options.now,
        closedBy: null,
      };
    }
    return 'saved' as const;
  })();

  if (closedEvent) options.events.emit('checkin.closed', closedEvent);
  return result;
}

type CheckinEventsClosed = {
  checkinId: number;
  closedAt: number;
  closedBy: number | null;
};

/** Closes an open check-in and carries forward only its missing accounts. */
export function closeCheckin(
  database: Database.Database,
  options: {
    checkinId: number;
    memberId: number;
    now: number;
    events: CheckinEventBus;
  },
): 'not_found' | 'closed' | 'done' {
  const result = database.transaction(() => {
    const checkin = database
      .prepare('SELECT closed_at FROM checkin WHERE id = ?')
      .get(options.checkinId) as { closed_at: bigint | null } | undefined;
    if (!checkin) return 'not_found' as const;
    if (checkin.closed_at !== null) return 'closed' as const;

    const missing = database
      .prepare(
        `SELECT a.id FROM account a
         LEFT JOIN snapshot s
           ON s.account_id = a.id AND s.checkin_id = ?
         WHERE a.active = 1 AND s.id IS NULL
         ORDER BY a.id`,
      )
      .all(options.checkinId) as Array<{ id: bigint }>;
    for (const { id } of missing) {
      const accountId = Number(id);
      const previous = previousBalance(
        database,
        accountId,
        options.checkinId,
        options.now,
      );
      database
        .prepare(
          `INSERT INTO snapshot
             (account_id, taken_at, amount, source, checkin_id, created_by,
              created_at, updated_by, updated_at)
           VALUES (?, ?, ?, 'carried_forward', ?, ?, ?, ?, ?)`,
        )
        .run(
          accountId,
          options.now,
          previous.amount,
          options.checkinId,
          options.memberId,
          options.now,
          options.memberId,
          options.now,
        );
    }
    database
      .prepare('UPDATE checkin SET closed_at = ?, closed_by = ? WHERE id = ?')
      .run(options.now, options.memberId, options.checkinId);
    return 'done' as const;
  })();

  if (result === 'done') {
    options.events.emit('checkin.closed', {
      checkinId: options.checkinId,
      closedAt: options.now,
      closedBy: options.memberId,
    });
  }
  return result;
}

function previousBalance(
  database: Database.Database,
  accountId: number,
  checkinId: number,
  at: number,
): { amount: bigint; takenAt: bigint | null; source: string | null } {
  const row = database
    .prepare(
      `SELECT s.amount, s.taken_at, s.source FROM snapshot s
       WHERE s.account_id = ? AND s.checkin_id IS NOT ? AND s.taken_at <= ?
       ORDER BY s.taken_at DESC, ${snapshotSourceOrder}, s.id DESC
       LIMIT 1`,
    )
    .get(accountId, checkinId, at) as
    { amount: bigint; taken_at: bigint; source: string } | undefined;
  return row
    ? { amount: row.amount, takenAt: row.taken_at, source: row.source }
    : { amount: 0n, takenAt: null, source: null };
}
