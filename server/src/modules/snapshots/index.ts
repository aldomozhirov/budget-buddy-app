import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  accountIdParamsSchema,
  createSnapshotRequestSchema,
  deleteSnapshotResponseSchema,
  endOfLocalDay,
  parseMinor,
  snapshotIdParamsSchema,
  snapshotResponseSchema,
  snapshotRevisionsResponseSchema,
  snapshotsResponseSchema,
  todayInTimeZone,
  toMinorString,
  updateSnapshotRequestSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import type { BackfillRequester } from '../../rates/service.js';

const sourceOrder = `CASE s.source
  WHEN 'connector' THEN 0 WHEN 'statement' THEN 1 WHEN 'photo' THEN 2
  WHEN 'checkin' THEN 3 WHEN 'manual' THEN 4 WHEN 'opening' THEN 5
  WHEN 'carried_forward' THEN 6 ELSE 7
END`;

type SnapshotRow = {
  id: bigint;
  account_id: bigint;
  taken_at: bigint;
  amount: bigint;
  source: string;
  checkin_id: bigint | null;
  created_by: bigint;
  created_by_name: string;
  created_at: bigint;
  updated_by: bigint;
  updated_by_name: string;
  updated_at: bigint;
};

/** Registers account snapshot history, balance entry, correction and revision routes. */
export const snapshotRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
  rates?: BackfillRequester;
}> = async (app, options) => {
  const { database, rates } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/accounts/:id/snapshots', async (request, reply) => {
    const parsed = accountIdParamsSchema.safeParse(request.params);
    if (!parsed.success)
      return sendValidation(reply, 'Check the account.', [
        { path: ['id'], message: 'Choose an account.' },
      ]);
    if (!accountExists(database, parsed.data.id))
      return sendNotFound(reply, 'Account not found.');
    const rows = database
      .prepare(
        `SELECT s.id, s.account_id, s.taken_at, s.amount, s.source, s.checkin_id,
                s.created_by, created.name AS created_by_name, s.created_at,
                s.updated_by, updated.name AS updated_by_name, s.updated_at
         FROM snapshot s
         JOIN member created ON created.id = s.created_by
         JOIN member updated ON updated.id = s.updated_by
         WHERE s.account_id = ?
         ORDER BY s.taken_at DESC, ${sourceOrder}, s.id DESC`,
      )
      .all(parsed.data.id) as SnapshotRow[];
    return snapshotsResponseSchema.parse({
      snapshots: rows.map(toSnapshotResponse),
    });
  });

  app.post('/api/accounts/:id/snapshots', async (request, reply) => {
    const parsedParams = accountIdParamsSchema.safeParse(request.params);
    const parsedBody = createSnapshotRequestSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return sendValidation(reply, 'Check the balance.', [
        ...(!parsedParams.success
          ? [{ path: ['id'], message: 'Choose an account.' }]
          : []),
        ...(!parsedBody.success ? parsedBody.error.issues : []),
      ]);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined)
      return sendProfileRequired(reply);
    if (!accountExists(database, parsedParams.data.id))
      return sendNotFound(reply, 'Account not found.');
    let amount: bigint;
    try {
      amount = parseMinor(parsedBody.data.amount);
    } catch (error) {
      const tooLarge =
        error instanceof RangeError && error.message === 'Amount is too large';
      return sendValidation(
        reply,
        tooLarge
          ? 'Amount is too large'
          : 'Enter a whole amount in minor units.',
        [
          {
            path: ['amount'],
            message: tooLarge ? 'Amount is too large' : 'Enter a valid amount.',
          },
        ],
      );
    }
    const now = clock.now().getTime();
    const takenAt = snapshotInstant(database, parsedBody.data.date, now);
    if (takenAt === null) {
      return sendValidation(reply, 'Choose today or an earlier date.', [
        { path: ['date'], message: 'A balance date cannot be in the future.' },
      ]);
    }
    const result = database
      .prepare(
        `INSERT INTO snapshot
           (account_id, taken_at, amount, source, created_by, created_at,
            updated_by, updated_at)
         VALUES (?, ?, ?, 'manual', ?, ?, ?, ?)`,
      )
      .run(parsedParams.data.id, takenAt, amount, memberId, now, memberId, now);
    const snapshot = findSnapshot(database, Number(result.lastInsertRowid));
    if (!snapshot) throw new Error('Created snapshot could not be reloaded.');
    rates?.requestBackfill();
    return reply.code(201).send(snapshotResponseSchema.parse({ snapshot }));
  });

  app.patch('/api/snapshots/:id', async (request, reply) => {
    const parsedParams = snapshotIdParamsSchema.safeParse(request.params);
    const parsedBody = updateSnapshotRequestSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return sendValidation(reply, 'Check the balance correction.', [
        ...(!parsedParams.success
          ? [{ path: ['id'], message: 'Choose a snapshot.' }]
          : []),
        ...(!parsedBody.success ? parsedBody.error.issues : []),
      ]);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined)
      return sendProfileRequired(reply);
    const current = database
      .prepare(
        'SELECT id, account_id, taken_at, amount FROM snapshot WHERE id = ?',
      )
      .get(parsedParams.data.id) as
      | { id: bigint; account_id: bigint; taken_at: bigint; amount: bigint }
      | undefined;
    if (!current) return sendNotFound(reply, 'Snapshot not found.');
    let amount = current.amount;
    if (parsedBody.data.amount !== undefined) {
      try {
        amount = parseMinor(parsedBody.data.amount);
      } catch (error) {
        const tooLarge =
          error instanceof RangeError &&
          error.message === 'Amount is too large';
        return sendValidation(
          reply,
          tooLarge
            ? 'Amount is too large'
            : 'Enter a whole amount in minor units.',
          [
            {
              path: ['amount'],
              message: tooLarge
                ? 'Amount is too large'
                : 'Enter a valid amount.',
            },
          ],
        );
      }
    }
    const now = clock.now().getTime();
    const takenAt =
      parsedBody.data.date === undefined
        ? Number(current.taken_at)
        : snapshotInstant(database, parsedBody.data.date, now);
    if (takenAt === null) {
      return sendValidation(reply, 'Choose today or an earlier date.', [
        { path: ['date'], message: 'A balance date cannot be in the future.' },
      ]);
    }
    const changed =
      amount !== current.amount || BigInt(takenAt) !== current.taken_at;
    if (changed) {
      database.transaction(() => {
        database
          .prepare(
            `INSERT INTO snapshot_revision
               (snapshot_id, account_id, action, old_amount, old_taken_at,
                changed_by, changed_at)
             VALUES (?, ?, 'update', ?, ?, ?, ?)`,
          )
          .run(
            current.id,
            current.account_id,
            current.amount,
            current.taken_at,
            memberId,
            now,
          );
        database
          .prepare(
            'UPDATE snapshot SET amount = ?, taken_at = ?, updated_by = ?, updated_at = ? WHERE id = ?',
          )
          .run(amount, takenAt, memberId, now, current.id);
      })();
    }
    const snapshot = findSnapshot(database, parsedParams.data.id);
    if (!snapshot) return sendNotFound(reply, 'Snapshot not found.');
    // A snapshot moved to an earlier date may be before the stored rates.
    if (changed) rates?.requestBackfill();
    return snapshotResponseSchema.parse({ snapshot });
  });

  app.delete('/api/snapshots/:id', async (request, reply) => {
    const parsed = snapshotIdParamsSchema.safeParse(request.params);
    if (!parsed.success)
      return sendValidation(reply, 'Check the balance.', [
        { path: ['id'], message: 'Choose a snapshot.' },
      ]);
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined)
      return sendProfileRequired(reply);
    const now = clock.now().getTime();
    const result = database.transaction(() => {
      const current = database
        .prepare(
          'SELECT id, account_id, taken_at, amount FROM snapshot WHERE id = ?',
        )
        .get(parsed.data.id) as
        | { id: bigint; account_id: bigint; taken_at: bigint; amount: bigint }
        | undefined;
      if (!current) return false;
      database
        .prepare(
          `INSERT INTO snapshot_revision
             (snapshot_id, account_id, action, old_amount, old_taken_at,
              changed_by, changed_at)
           VALUES (?, ?, 'delete', ?, ?, ?, ?)`,
        )
        .run(
          current.id,
          current.account_id,
          current.amount,
          current.taken_at,
          memberId,
          now,
        );
      database.prepare('DELETE FROM snapshot WHERE id = ?').run(current.id);
      return true;
    })();
    if (!result) return sendNotFound(reply, 'Snapshot not found.');
    return deleteSnapshotResponseSchema.parse({ deleted: true });
  });

  app.get('/api/snapshots/:id/revisions', async (request, reply) => {
    const parsed = snapshotIdParamsSchema.safeParse(request.params);
    if (!parsed.success)
      return sendValidation(reply, 'Check the snapshot.', [
        { path: ['id'], message: 'Choose a snapshot.' },
      ]);
    const rows = database
      .prepare(
        `SELECT r.id, r.snapshot_id, r.account_id, r.action, r.old_amount,
                r.old_taken_at, r.changed_by, m.name AS changed_by_name,
                r.changed_at
         FROM snapshot_revision r
         JOIN member m ON m.id = r.changed_by
         WHERE r.snapshot_id = ? ORDER BY r.changed_at DESC, r.id DESC`,
      )
      .all(parsed.data.id) as Array<{
      id: bigint;
      snapshot_id: bigint;
      account_id: bigint;
      action: 'update' | 'delete';
      old_amount: bigint;
      old_taken_at: bigint;
      changed_by: bigint;
      changed_by_name: string;
      changed_at: bigint;
    }>;
    return snapshotRevisionsResponseSchema.parse({
      revisions: rows.map((row) => ({
        id: Number(row.id),
        snapshotId: Number(row.snapshot_id),
        accountId: Number(row.account_id),
        action: row.action,
        oldAmount: toMinorString(row.old_amount),
        oldTakenAt: Number(row.old_taken_at),
        changedBy: Number(row.changed_by),
        changedByName: row.changed_by_name,
        changedAt: Number(row.changed_at),
      })),
    });
  });
};

function accountExists(database: Database.Database, id: number): boolean {
  return (
    database.prepare('SELECT 1 FROM account WHERE id = ?').get(id) !== undefined
  );
}

function findSnapshot(database: Database.Database, id: number) {
  const row = database
    .prepare(
      `SELECT s.id, s.account_id, s.taken_at, s.amount, s.source, s.checkin_id,
              s.created_by, created.name AS created_by_name, s.created_at,
              s.updated_by, updated.name AS updated_by_name, s.updated_at
       FROM snapshot s
       JOIN member created ON created.id = s.created_by
       JOIN member updated ON updated.id = s.updated_by
       WHERE s.id = ?`,
    )
    .get(id) as SnapshotRow | undefined;
  return row ? toSnapshotResponse(row) : undefined;
}

function toSnapshotResponse(row: SnapshotRow) {
  return {
    id: Number(row.id),
    accountId: Number(row.account_id),
    takenAt: Number(row.taken_at),
    amount: toMinorString(row.amount),
    source: row.source,
    checkinId: row.checkin_id === null ? null : Number(row.checkin_id),
    createdBy: Number(row.created_by),
    createdByName: row.created_by_name,
    createdAt: Number(row.created_at),
    updatedBy: Number(row.updated_by),
    updatedByName: row.updated_by_name,
    updatedAt: Number(row.updated_at),
  };
}

function snapshotInstant(
  database: Database.Database,
  date: string | undefined,
  now: number,
): number | null {
  if (date === undefined) return now;
  const family = database
    .prepare('SELECT time_zone FROM family WHERE id = 1')
    .get() as { time_zone: string } | undefined;
  if (!family) return null;
  try {
    const localToday = todayInTimeZone(new Date(now), family.time_zone);
    if (date > localToday) return null;
    if (date === localToday) return now;
    return endOfLocalDay(date, family.time_zone).getTime();
  } catch {
    return null;
  }
}

function sendValidation(
  reply: FastifyReply,
  message: string,
  issues: readonly { path: PropertyKey[]; message: string }[],
) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    fields[field] ??= issue.message;
  }
  return reply
    .code(400)
    .send({ error: { code: 'validation', message, fields } });
}

function sendNotFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: { code: 'not_found', message } });
}

function sendProfileRequired(reply: FastifyReply) {
  return reply.code(403).send({
    error: { code: 'profile_required', message: 'Choose a profile first.' },
  });
}
