import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { changeFamilyPasswordRequestSchema } from '@budget-buddy/shared';

/** Registers changes to the shared family password. */
export const familyRoutes: FastifyPluginAsync<{
  database: Database.Database;
}> = async (app, { database }) => {
  app.put('/api/family/password', async (request, reply) => {
    const parsed = changeFamilyPasswordRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'form');
        fields[field] ??= issue.message;
      }
      return sendValidation(reply, 'Check the password fields.', fields);
    }

    const currentFamily = database
      .prepare('SELECT password_hash FROM family WHERE id = 1')
      .get() as { password_hash: string } | undefined;
    if (!currentFamily) {
      return reply.code(403).send({
        error: {
          code: 'forbidden_state',
          message: 'First start has not been completed.',
        },
      });
    }
    if (
      !(await verify(currentFamily.password_hash, parsed.data.currentPassword))
    ) {
      return sendValidation(reply, 'The current password doesn’t match.', {
        currentPassword: 'The current password doesn’t match.',
      });
    }

    const passwordHash = await hash(parsed.data.newPassword, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const context = request.authContext!;
    const changed = database.transaction(() => {
      const family = database
        .prepare('SELECT password_hash FROM family WHERE id = 1')
        .get() as { password_hash: string } | undefined;
      const currentSession = database
        .prepare('SELECT id FROM session WHERE id = ? AND device_id = ?')
        .get(context.sessionId, context.deviceId);
      if (!family || family.password_hash !== currentFamily.password_hash) {
        return false;
      }
      if (!currentSession) return false;

      database
        .prepare(
          'UPDATE family SET password_hash = ?, password_epoch = password_epoch + 1, failed_signins = 0, locked_until = NULL WHERE id = 1',
        )
        .run(passwordHash);
      database
        .prepare(
          'UPDATE session SET password_epoch = (SELECT password_epoch FROM family WHERE id = 1) WHERE id = ?',
        )
        .run(context.sessionId);
      database
        .prepare('DELETE FROM session WHERE id <> ?')
        .run(context.sessionId);
      database
        .prepare('DELETE FROM passkey WHERE device_id <> ?')
        .run(context.deviceId);
      return true;
    })();

    if (!changed) {
      return reply.code(409).send({
        error: {
          code: 'conflict',
          message: 'The family password changed in another session. Try again.',
        },
      });
    }
    return { changed: true };
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
