import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = {
  origin,
  'content-type': 'application/json',
};
const openRoutes = new Set([
  'GET /api/health',
  'HEAD /api/health',
  'GET /api/setup',
  'HEAD /api/setup',
  'POST /api/setup',
  'GET /api/auth/device',
  'HEAD /api/auth/device',
  'POST /api/auth/sign-in',
]);

describe('authentication integration', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let backupDirectory: string;
  let now: number;

  beforeEach(async () => {
    backupDirectory = await mkdtemp(join(tmpdir(), 'budget-buddy-auth-'));
    database = new Database(join(backupDirectory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, {
      backupDir: backupDirectory,
      migrationsFolder,
    });
    now = Date.parse('2026-10-08T12:34:56.000Z');
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(backupDirectory, { recursive: true, force: true });
  });

  it('requires a session on every protected route in the API route table', async () => {
    const routes = apiRouteTable();
    expect(routes).not.toHaveLength(0);
    for (const route of routes) {
      const isOpen = openRoutes.has(`${route.method} ${route.url}`);
      const response = await injectRoute(route.method, route.url);
      if (isOpen) {
        expect(response.statusCode, `${route.method} ${route.url}`).not.toBe(
          401,
        );
      } else {
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
        if (route.method !== 'HEAD') {
          expect(response.json().error.code).toBe('unauthenticated');
        }
      }
    }
  });

  it('rejects unsafe requests with a foreign Origin before checking session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/profile',
      headers: { ...jsonHeaders, origin: 'https://attacker.example' },
      payload: { memberId: 1, remember: true },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden_state');
  });

  it('locks on the third wrong password, keeps the lock through restart, and resets after a correct password', async () => {
    await createFamily();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await signIn('wrong password');
      expect(response.statusCode).toBe(401);
      expect(response.json().error.triesLeft).toBe(3 - attempt);
    }

    const locked = await signIn('wrong password');
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error).toMatchObject({
      code: 'locked',
      retryAfter: 30,
      triesLeft: 0,
    });
    expect(
      database.prepare('SELECT locked_until FROM family WHERE id = 1').get(),
    ).toEqual({ locked_until: BigInt(now + 30_000) });

    await restartServer();
    const stillLocked = await signIn('correct family password');
    expect(stillLocked.statusCode).toBe(423);
    expect(stillLocked.json().error.retryAfter).toBe(30);

    now += 30_000;
    const signedIn = await signIn('correct family password');
    expect(signedIn.statusCode).toBe(200);
    expect(
      database
        .prepare('SELECT failed_signins, locked_until FROM family WHERE id = 1')
        .get(),
    ).toEqual({ failed_signins: 0n, locked_until: null });

    const nextWrongAttempt = await signIn('wrong password');
    expect(nextWrongAttempt.statusCode).toBe(401);
    expect(nextWrongAttempt.json().error.triesLeft).toBe(2);
  });

  it('refuses an expired session and extends a session on successful use', async () => {
    const setup = await createFamily();
    const cookies = sessionCookies(setup);
    const initial = database
      .prepare('SELECT expires_at FROM session')
      .get() as { expires_at: bigint };

    now += 89 * 24 * 60 * 60 * 1000;
    const used = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookies },
    });
    expect(used.statusCode).toBe(200);
    const extended = database
      .prepare('SELECT expires_at FROM session')
      .get() as { expires_at: bigint };
    expect(extended.expires_at).toBeGreaterThan(initial.expires_at);
    expect(extended.expires_at).toBe(BigInt(now + 90 * 24 * 60 * 60 * 1000));

    now += 90 * 24 * 60 * 60 * 1000;
    const expired = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookies },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('unauthenticated');
  });

  it('does not open an inactive profile', async () => {
    await createFamily(['Alex', 'Blair']);
    const signInResponse = await signIn('correct family password');
    const cookies = sessionCookies(signInResponse);
    const blair = database
      .prepare("SELECT id FROM member WHERE name = 'Blair'")
      .get() as { id: bigint };
    database.prepare('UPDATE member SET active = 0 WHERE id = ?').run(blair.id);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/profile',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: { memberId: Number(blair.id), remember: true },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden_state');
  });

  it('signs out the session without forgetting the device default', async () => {
    const setup = await createFamily();
    const originalCookies = sessionCookies(setup);
    const deviceCookie = originalCookies
      .split('; ')
      .find((cookie) => cookie.startsWith('bb_device='));
    expect(deviceCookie).toBeDefined();

    const signedOut = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { ...jsonHeaders, cookie: originalCookies },
      payload: {},
    });
    expect(signedOut.statusCode).toBe(200);
    expect(signedOut.json()).toEqual({ signedOut: true });
    const clearedSessionCookie = signedOut.headers['set-cookie'];
    expect(clearedSessionCookie).toEqual(
      expect.arrayContaining([expect.stringContaining('bb_session=;')]),
    );

    const refusedSession = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: originalCookies },
    });
    expect(refusedSession.statusCode).toBe(401);

    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { ...jsonHeaders, cookie: deviceCookie },
      payload: { password: 'correct family password' },
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).toEqual({ profileRequired: false });

    const state = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookies(signedIn) },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().member).toEqual({ id: 1, name: 'Alex' });
  });

  async function makeApp() {
    return createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock: { now: () => new Date(now) },
    });
  }

  async function restartServer(): Promise<void> {
    await app.close();
    database.close();
    database = new Database(join(backupDirectory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, {
      backupDir: backupDirectory,
      migrationsFolder,
    });
    app = await makeApp();
  }

  async function createFamily(profiles = ['Alex']): Promise<{
    headers: Record<string, unknown>;
    statusCode: number;
  }> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: jsonHeaders,
      payload: {
        password: 'correct family password',
        passwordConfirmation: 'correct family password',
        profiles,
      },
    });
    expect(response.statusCode).toBe(201);
    return { headers: response.headers, statusCode: response.statusCode };
  }

  async function signIn(password: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: jsonHeaders,
      payload: { password },
    });
  }

  async function injectRoute(method: string, url: string) {
    const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const options: InjectOptions = {
      method: method as NonNullable<InjectOptions['method']>,
      url,
      ...(stateChanging ? { headers: jsonHeaders, payload: {} } : {}),
    };
    return app.inject(options);
  }

  function apiRouteTable(): Array<{ method: string; url: string }> {
    return app
      .printRoutes({ commonPrefix: false })
      .split('\n')
      .flatMap((line) => {
        const match = line.trim().match(/^[├└]── (\/api\/\S+) \(([^)]+)\)$/u);
        if (!match) return [];
        const [, url, methods] = match;
        return methods!.split(', ').map((method) => ({ url: url!, method }));
      });
  }
});

function sessionCookies(response: {
  headers: Record<string, unknown>;
}): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies
    .filter((cookie): cookie is string => typeof cookie === 'string')
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}
