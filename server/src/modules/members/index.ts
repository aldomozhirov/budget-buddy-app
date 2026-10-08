import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  createMemberRequestSchema,
  memberIdParamsSchema,
  memberResponseSchema,
  membersResponseSchema,
  updateMemberRequestSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';

/** Registers profile listing, creation, renaming and activation routes. */
export const memberRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/members', async () => {
    const members = database
      .prepare(
        'SELECT id, name, active FROM member ORDER BY active DESC, id ASC',
      )
      .all() as Array<{ id: bigint; name: string; active: bigint }>;
    return membersResponseSchema.parse({
      members: members.map(({ id, name, active }) => ({
        id: Number(id),
        name,
        active: active === 1n,
      })),
    });
  });

  app.post('/api/members', async (request, reply) => {
    const parsed = createMemberRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(reply, 'Enter a profile name.', {
        name: 'Enter a profile name.',
      });
    }

    try {
      const result = database
        .prepare('INSERT INTO member (name, created_at) VALUES (?, ?)')
        .run(parsed.data.name, clock.now().getTime());
      const member = {
        id: Number(result.lastInsertRowid),
        name: parsed.data.name,
        active: true,
      };
      return reply.code(201).send(memberResponseSchema.parse({ member }));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return sendNameConflict(reply);
      }
      throw error;
    }
  });

  app.patch('/api/members/:id', async (request, reply) => {
    const parsedParams = memberIdParamsSchema.safeParse(request.params);
    const parsedBody = updateMemberRequestSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return sendValidation(reply, 'Check the profile details.', {
        form: 'Check the profile details.',
      });
    }

    const { id } = parsedParams.data;
    const { name, active } = parsedBody.data;
    try {
      const result = database.transaction(() => {
        const current = database
          .prepare(
            'SELECT id, name, active, deactivated_at FROM member WHERE id = ?',
          )
          .get(id) as
          | {
              id: bigint;
              name: string;
              active: bigint;
              deactivated_at: bigint | null;
            }
          | undefined;
        if (!current) return { kind: 'not_found' } as const;

        const wasActive = current.active === 1n;
        const willBeActive = active ?? wasActive;
        if (wasActive && !willBeActive) {
          const activeCount = database
            .prepare('SELECT COUNT(*) AS count FROM member WHERE active = 1')
            .get() as { count: bigint };
          if (activeCount.count <= 1n) return { kind: 'last_active' } as const;
        }

        const updatedName = name ?? current.name;
        const now = clock.now().getTime();
        database
          .prepare(
            'UPDATE member SET name = ?, active = ?, deactivated_at = ? WHERE id = ?',
          )
          .run(
            updatedName,
            willBeActive ? 1 : 0,
            willBeActive ? null : wasActive ? now : current.deactivated_at,
            id,
          );
        if (wasActive && !willBeActive) {
          database
            .prepare(
              'UPDATE device SET default_member_id = NULL WHERE default_member_id = ?',
            )
            .run(id);
        }
        return {
          kind: 'ok',
          member: { id, name: updatedName, active: willBeActive },
        } as const;
      })();

      if (result.kind === 'not_found') {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'Profile not found.' },
        });
      }
      if (result.kind === 'last_active') {
        return reply.code(409).send({
          error: {
            code: 'conflict',
            message: 'At least one profile must stay active.',
          },
        });
      }
      return memberResponseSchema.parse({ member: result.member });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return sendNameConflict(reply);
      }
      throw error;
    }
  });
};

function sendValidation(
  reply: FastifyReply,
  message: string,
  fields: Record<string, string>,
) {
  return reply.code(400).send({
    error: { code: 'validation', message, fields },
  });
}

function sendNameConflict(reply: FastifyReply) {
  return reply.code(409).send({
    error: {
      code: 'conflict',
      message: 'A profile with that name is already active.',
      fields: { name: 'A profile with that name is already active.' },
    },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}
