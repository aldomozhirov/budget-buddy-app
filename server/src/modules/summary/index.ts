import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  checkinIdParamsSchema,
  checkinSummarySchema,
  wealthSeriesQuerySchema,
  wealthSeriesSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { getCheckinSummary } from '../../domain/summary.js';
import { getWealthSeries } from '../../domain/wealthSeries.js';

/** Registers the check-in summary and wealth chart routes (SUM-1 to SUM-6). */
export const summaryRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/checkins/:id/summary', async (request, reply) => {
    const parsed = checkinIdParamsSchema.safeParse(request.params);
    if (!parsed.success)
      return sendError(reply, 400, 'validation', 'Choose a check-in.');
    if (!hasProfile(request.authContext?.memberId))
      return sendError(
        reply,
        403,
        'profile_required',
        'Choose a profile first.',
      );
    const result = getCheckinSummary(database, parsed.data.id);
    if (result.status === 'not_found')
      return sendError(reply, 404, 'not_found', 'Check-in not found.');
    if (result.status === 'open')
      return sendError(
        reply,
        403,
        'forbidden_state',
        'This check-in is still open.',
      );
    return checkinSummarySchema.parse(result.summary);
  });

  app.get('/api/wealth/series', async (request, reply) => {
    const parsed = wealthSeriesQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return sendError(
        reply,
        400,
        'validation',
        parsed.error.issues[0]?.message ?? 'Check the chart options.',
      );
    if (!hasProfile(request.authContext?.memberId))
      return sendError(
        reply,
        403,
        'profile_required',
        'Choose a profile first.',
      );
    const result = getWealthSeries(database, {
      ...parsed.data,
      now: clock.now().getTime(),
    });
    if (result.status === 'unknown_currency')
      return sendError(reply, 400, 'validation', 'Unknown currency.');
    return wealthSeriesSchema.parse(result.series);
  });
};

function hasProfile(memberId: number | null | undefined): boolean {
  return memberId !== null && memberId !== undefined;
}

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) {
  return reply.code(status).send({ error: { code, message } });
}
