import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import { Algorithm, hash } from '@node-rs/argon2';
import { z } from 'zod';
import { systemClock, type Clock } from '../../clock.js';

const setupBodySchema = z
  .object({
    password: z.string().min(10, 'Use at least 10 characters.'),
    passwordConfirmation: z.string().min(1, 'Repeat the family password.'),
    profiles: z.array(z.string().trim().min(1, 'Enter a profile name.')).min(1),
  })
  .strict()
  .superRefine((body, context) => {
    if (body.password !== body.passwordConfirmation) {
      context.addIssue({
        code: 'custom',
        path: ['passwordConfirmation'],
        message: 'The passwords do not match.',
      });
    }
  });

const sessionLifetimeMs = 90 * 24 * 60 * 60 * 1000;

const initialCoins = [
  { code: 'BTC', name: 'Bitcoin', decimals: 8, feedId: 'BTC-EUR' },
  { code: 'ETH', name: 'Ethereum', decimals: 8, feedId: 'ETH-EUR' },
  { code: 'USDT', name: 'Tether', decimals: 6, feedId: 'USDT-EUR' },
] as const;

/** Registers the open first-start status and family creation routes. */
export const setupRoutes: FastifyPluginAsync<{
  database: Database.Database;
  secureCookies?: boolean;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;
  const secureCookies = options.secureCookies ?? true;

  app.get('/api/setup', { config: { auth: 'open' } }, async () => ({
    needed: !hasMembers(database),
  }));

  app.post(
    '/api/setup',
    { config: { auth: 'open' } },
    async (request, reply) => {
      if (hasMembers(database) || hasFamily(database)) {
        return reply.code(403).send({
          error: {
            code: 'forbidden_state',
            message: 'First start has already been completed.',
          },
        });
      }

      const parsed = setupBodySchema.safeParse(request.body);
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? 'form');
          fields[field] ??= issue.message;
        }
        return reply.code(400).send({
          error: {
            code: 'validation',
            message: 'Check the highlighted fields.',
            fields,
          },
        });
      }

      const passwordHash = await hash(parsed.data.password, {
        algorithm: Algorithm.Argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      });
      const now = clock.now().getTime();
      const deviceId = randomBytes(16).toString('hex');
      const sessionToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(sessionToken).digest('hex');

      try {
        const created = database.transaction(() => {
          if (hasMembers(database) || hasFamily(database)) return undefined;

          database
            .prepare(
              'INSERT INTO family (id, password_hash, created_at) VALUES (1, ?, ?)',
            )
            .run(passwordHash, now);
          const insertCoin = database.prepare(
            'INSERT INTO coin (code, name, decimals, feed_id, created_at) VALUES (?, ?, ?, ?, ?)',
          );
          for (const coin of initialCoins) {
            insertCoin.run(
              coin.code,
              coin.name,
              coin.decimals,
              coin.feedId,
              now,
            );
          }
          const insertMember = database.prepare(
            'INSERT INTO member (name, created_at) VALUES (?, ?)',
          );
          const members = parsed.data.profiles.map((name) => {
            const result = insertMember.run(name, now);
            return Number(result.lastInsertRowid);
          });
          const firstMemberId = members[0];
          if (firstMemberId === undefined) return undefined;

          database
            .prepare(
              'INSERT INTO device (id, default_member_id, label, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
            )
            .run(
              deviceId,
              firstMemberId,
              request.headers['user-agent'] ?? null,
              now,
              now,
            );
          database
            .prepare(
              'INSERT INTO session (token_hash, device_id, member_id, password_epoch, created_at, last_used_at, expires_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
            )
            .run(
              tokenHash,
              deviceId,
              firstMemberId,
              now,
              now,
              now + sessionLifetimeMs,
            );
          return firstMemberId;
        })();

        if (created === undefined) {
          return reply.code(403).send({
            error: {
              code: 'forbidden_state',
              message: 'First start has already been completed.',
            },
          });
        }

        const flags = `Path=/; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}; Max-Age=${sessionLifetimeMs / 1000}`;
        reply.header('Set-Cookie', [
          `bb_device=${deviceId}; ${flags}`,
          `bb_session=${sessionToken}; ${flags}`,
        ]);
        return reply.code(201).send({ needed: false });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return reply.code(400).send({
            error: {
              code: 'validation',
              message: 'Profile names must be different.',
              fields: { profiles: 'Profile names must be different.' },
            },
          });
        }
        throw error;
      }
    },
  );
};

function hasMembers(database: Database.Database): boolean {
  return Boolean(database.prepare('SELECT 1 FROM member LIMIT 1').get());
}

function hasFamily(database: Database.Database): boolean {
  return Boolean(database.prepare('SELECT 1 FROM family WHERE id = 1').get());
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}
