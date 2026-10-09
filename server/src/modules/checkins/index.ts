import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  checkinIdParamsSchema,
  checkinResponseSchema,
  checkinsResponseSchema,
  checkinValueParamsSchema,
  currentCheckinResponseSchema,
  isMinorInRange,
  parseMinor,
  saveCheckinValueRequestSchema,
  startCheckinRequestSchema,
  startCheckinResponseSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import type { CheckinEventBus } from '../../events.js';
import {
  closeCheckin,
  getCheckin,
  saveCheckinValue,
  startCheckin,
} from '../../domain/checkin.js';

/** Registers check-in lifecycle and balance-entry API routes. */
export const checkinRoutes: FastifyPluginAsync<{
  database: Database.Database;
  events: CheckinEventBus;
  clock?: Clock;
}> = async (app, options) => {
  const { database, events } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/checkins', async (request, reply) => {
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined)
      return sendProfileRequired(reply);
    const ids = database
      .prepare('SELECT id FROM checkin ORDER BY opened_at DESC, id DESC')
      .all() as Array<{ id: bigint }>;
    const now = clock.now().getTime();
    return checkinsResponseSchema.parse({
      checkins: ids.flatMap(({ id }) => {
        const checkin = getCheckin(database, Number(id), memberId, now);
        return checkin ? [checkin] : [];
      }),
    });
  });

  app.post('/api/checkins', async (request, reply) => {
    const parsed = startCheckinRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success)
      return sendValidation(reply, 'Start a check-in without extra fields.', [
        ...parsed.error.issues,
      ]);
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined)
      return sendProfileRequired(reply);
    const openedAt = clock.now().getTime();
    const result = startCheckin(database, {
      openedBy: memberId,
      now: openedAt,
      events,
    });
    const checkin = getCheckin(database, result.checkinId, memberId, openedAt);
    if (!checkin) throw new Error('Started check-in could not be reloaded.');
    return reply
      .code(result.joined ? 200 : 201)
      .send(
        startCheckinResponseSchema.parse({ checkin, joined: result.joined }),
      );
  });

  app.get('/api/checkins/current', async (request) => {
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) return { checkin: null };
    const open = database
      .prepare('SELECT id FROM checkin WHERE closed_at IS NULL')
      .get() as { id: bigint } | undefined;
    const checkin = open
      ? getCheckin(database, Number(open.id), memberId, clock.now().getTime())
      : null;
    return currentCheckinResponseSchema.parse({ checkin: checkin ?? null });
  });

  app.get('/api/checkins/:id', async (request, reply) => {
    const parsed = checkinIdParamsSchema.safeParse(request.params);
    if (!parsed.success)
      return sendValidation(reply, 'Choose a check-in.', [
        { path: ['id'], message: 'Choose a check-in.' },
      ]);
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined)
      return sendProfileRequired(reply);
    const checkin = getCheckin(
      database,
      parsed.data.id,
      memberId,
      clock.now().getTime(),
    );
    if (!checkin) return sendNotFound(reply, 'Check-in not found.');
    return checkinResponseSchema.parse({ checkin });
  });

  app.put('/api/checkins/:id/values/:accountId', async (request, reply) => {
    const parsedParams = checkinValueParamsSchema.safeParse(request.params);
    const parsedBody = saveCheckinValueRequestSchema.safeParse(request.body);
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
    let amount: bigint | 'same';
    if ('same' in parsedBody.data) {
      amount = 'same';
    } else {
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
      if (!isMinorInRange(amount)) {
        return sendValidation(reply, 'Amount is too large', [
          { path: ['amount'], message: 'Amount is too large' },
        ]);
      }
    }
    const now = clock.now().getTime();
    const result = saveCheckinValue(database, {
      checkinId: parsedParams.data.id,
      accountId: parsedParams.data.accountId,
      memberId,
      amount,
      now,
      events,
    });
    if (result === 'not_found')
      return sendNotFound(reply, 'Check-in not found.');
    if (result === 'closed')
      return sendForbiddenState(reply, 'This check-in is already closed.');
    if (result === 'inactive_account')
      return sendForbiddenState(
        reply,
        'This account is no longer in the check-in.',
      );
    const checkin = getCheckin(database, parsedParams.data.id, memberId, now);
    if (!checkin) return sendNotFound(reply, 'Check-in not found.');
    return checkinResponseSchema.parse({ checkin });
  });

  app.post('/api/checkins/:id/close', async (request, reply) => {
    const parsed = checkinIdParamsSchema.safeParse(request.params);
    if (!parsed.success)
      return sendValidation(reply, 'Choose a check-in.', [
        { path: ['id'], message: 'Choose a check-in.' },
      ]);
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined)
      return sendProfileRequired(reply);
    const now = clock.now().getTime();
    const result = closeCheckin(database, {
      checkinId: parsed.data.id,
      memberId,
      now,
      events,
    });
    if (result === 'not_found')
      return sendNotFound(reply, 'Check-in not found.');
    if (result === 'closed')
      return sendForbiddenState(reply, 'This check-in is already closed.');
    const checkin = getCheckin(database, parsed.data.id, memberId, now);
    if (!checkin) return sendNotFound(reply, 'Check-in not found.');
    return checkinResponseSchema.parse({ checkin });
  });
};

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

function sendForbiddenState(reply: FastifyReply, message: string) {
  return reply.code(403).send({ error: { code: 'forbidden_state', message } });
}
