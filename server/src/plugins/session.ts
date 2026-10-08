import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { systemClock, type Clock } from '../clock.js';

const sessionLifetimeMs = 90 * 24 * 60 * 60 * 1000;

/** Authorization level applied to an API route by its route config. */
export type AuthRequirement = 'open' | 'session' | 'profile';

/** Authenticated session and optional active profile attached to a request. */
export type AuthContext = {
  sessionId: number;
  deviceId: string;
  memberId: number | null;
  memberName: string | null;
  defaultMemberId: number | null;
  hasPasskey: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }

  interface FastifyContextConfig {
    auth?: AuthRequirement;
  }
}

/** Installs sliding, cookie-backed session authentication on API routes. */
export async function installSessionPlugin(
  app: FastifyInstance,
  options: {
    database: Database.Database;
    secureCookies: boolean;
    clock?: Clock;
  },
): Promise<void> {
  const clock = options.clock ?? systemClock;
  app.decorateRequest('authContext', null);

  app.addHook('preHandler', async (request, reply) => {
    const routeUrl = request.routeOptions.url;
    if (
      !request.url.startsWith('/api/') ||
      !routeUrl ||
      routeUrl === '/*' ||
      !app.hasRoute({ method: request.method, url: routeUrl })
    ) {
      return;
    }
    const requirement = request.routeOptions.config.auth ?? 'profile';
    if (requirement === 'open') return;

    const sessionToken = readCookie(request.headers.cookie, 'bb_session');
    const deviceCookie = readCookie(request.headers.cookie, 'bb_device');
    if (!sessionToken || !deviceCookie) {
      return sendUnauthenticated(reply);
    }

    const row = options.database
      .prepare(
        `SELECT s.id AS session_id, s.device_id, s.member_id,
                s.password_epoch, s.expires_at, f.password_epoch AS current_epoch,
                m.name AS member_name, m.active AS member_active,
                d.default_member_id,
                EXISTS (SELECT 1 FROM passkey p WHERE p.device_id = d.id)
                  AS has_passkey
         FROM session s
         JOIN family f ON f.id = 1
         JOIN device d ON d.id = s.device_id
         LEFT JOIN member m ON m.id = s.member_id
         WHERE s.token_hash = ? AND s.device_id = ?`,
      )
      .get(
        createHash('sha256').update(sessionToken).digest('hex'),
        deviceCookie,
      ) as
      | {
          session_id: bigint;
          device_id: string;
          member_id: bigint | null;
          password_epoch: bigint;
          expires_at: bigint;
          current_epoch: bigint;
          member_name: string | null;
          member_active: bigint | null;
          default_member_id: bigint | null;
          has_passkey: bigint;
        }
      | undefined;

    const now = clock.now().getTime();
    if (
      !row ||
      row.expires_at <= BigInt(now) ||
      row.password_epoch !== row.current_epoch ||
      (row.member_id !== null && row.member_active !== 1n)
    ) {
      return sendUnauthenticated(reply);
    }

    if (requirement === 'profile' && row.member_id === null) {
      return reply.code(403).send({
        error: { code: 'profile_required', message: 'Choose a profile first.' },
      });
    }

    const expiresAt = now + sessionLifetimeMs;
    const touched = options.database.transaction(() => {
      const result = options.database
        .prepare(
          'UPDATE session SET last_used_at = ?, expires_at = ? WHERE id = ? AND expires_at > ?',
        )
        .run(now, expiresAt, row.session_id, now);
      if (result.changes !== 1) return false;
      options.database
        .prepare('UPDATE device SET last_seen_at = ? WHERE id = ?')
        .run(now, row.device_id);
      return true;
    })();
    if (!touched) return sendUnauthenticated(reply);

    request.authContext = {
      sessionId: Number(row.session_id),
      deviceId: row.device_id,
      memberId: row.member_id === null ? null : Number(row.member_id),
      memberName: row.member_name,
      defaultMemberId:
        row.default_member_id === null ? null : Number(row.default_member_id),
      hasPasskey: row.has_passkey === 1n,
    };

    setSessionCookies(reply, {
      deviceId: deviceCookie,
      sessionToken,
      secureCookies: options.secureCookies,
    });
  });
}

/** Reads and decodes one cookie value from a request header. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  const cookies = parseCookies(header);
  return cookies[name];
}

/** Refreshes both authentication cookies after a successful session use. */
export function setSessionCookies(
  reply: FastifyReply,
  options: { deviceId: string; sessionToken: string; secureCookies: boolean },
): void {
  reply.header('Set-Cookie', [
    sessionCookie('bb_device', options.deviceId, options.secureCookies),
    sessionCookie('bb_session', options.sessionToken, options.secureCookies),
  ]);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function sessionCookie(name: string, value: string, secure: boolean): string {
  const flags = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${sessionLifetimeMs / 1000}`;
  return `${name}=${encodeURIComponent(value)}; ${flags}`;
}

function sendUnauthenticated(reply: FastifyReply) {
  return reply.code(401).send({
    error: { code: 'unauthenticated', message: 'Sign in to continue.' },
  });
}
