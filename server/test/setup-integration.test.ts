import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { verify } from '@node-rs/argon2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const fixedNow = new Date('2026-10-08T12:34:56.000Z');
const setupOrigin = 'https://budget-buddy.test';
const secondOrigin = 'https://mac.tailnet.ts.net:5443';
const setupHeaders = {
  origin: setupOrigin,
  'content-type': 'application/json',
  'user-agent': 'BudgetBuddyTest/1.0',
};

describe('first-start setup integration', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let backupDirectory: string;

  beforeEach(async () => {
    backupDirectory = await mkdtemp(join(tmpdir(), 'budget-buddy-setup-'));
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, {
      backupDir: backupDirectory,
      migrationsFolder,
    });
    app = await createApp({
      database,
      logger: false,
      appOrigins: [setupOrigin, secondOrigin],
      clock: { now: () => fixedNow },
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(backupDirectory, { recursive: true, force: true });
  });

  it('creates the family, profiles, default device and authenticated session', async () => {
    const initialStatus = await app.inject({
      method: 'GET',
      url: '/api/setup',
    });
    expect(initialStatus.statusCode).toBe(200);
    expect(initialStatus.json()).toEqual({ needed: true });

    const password = 'correct horse battery staple';
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: setupHeaders,
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex', 'Blair'],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ needed: false });
    const family = database
      .prepare('SELECT password_hash, password_epoch, created_at FROM family')
      .get() as {
      password_hash: string;
      password_epoch: bigint;
      created_at: bigint;
    };
    expect(family.password_hash).not.toBe(password);
    expect(family.password_hash).toMatch(/^\$argon2id\$/);
    await expect(verify(family.password_hash, password)).resolves.toBe(true);
    expect(family).toMatchObject({
      password_epoch: 0n,
      created_at: BigInt(fixedNow.getTime()),
    });

    const members = database
      .prepare('SELECT id, name, active, created_at FROM member ORDER BY id')
      .all() as Array<{
      id: bigint;
      name: string;
      active: bigint;
      created_at: bigint;
    }>;
    expect(members).toHaveLength(2);
    expect(members.map(({ name }) => name)).toEqual(['Alex', 'Blair']);
    expect(
      members.every(
        ({ active, created_at }) =>
          active === 1n && created_at === BigInt(fixedNow.getTime()),
      ),
    ).toBe(true);

    const cookies = response.headers['set-cookie'];
    const cookieList = Array.isArray(cookies) ? cookies : [cookies ?? ''];
    const deviceCookie = cookieList.find((cookie) =>
      cookie.startsWith('bb_device='),
    );
    const sessionCookie = cookieList.find((cookie) =>
      cookie.startsWith('bb_session='),
    );
    expect(deviceCookie).toBeDefined();
    expect(sessionCookie).toBeDefined();
    expect(deviceCookie).toContain('HttpOnly');
    expect(deviceCookie).toContain('SameSite=Lax');
    expect(deviceCookie).toContain('Path=/');
    expect(deviceCookie).toContain('Secure');
    expect(deviceCookie).toContain('Max-Age=7776000');
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).toContain('Secure');
    expect(sessionCookie).toContain('Max-Age=7776000');

    const deviceId = deviceCookie?.split(';', 1)[0]?.slice('bb_device='.length);
    const sessionToken = sessionCookie
      ?.split(';', 1)[0]
      ?.slice('bb_session='.length);
    expect(deviceId).toMatch(/^[0-9a-f]{32}$/);
    expect(sessionToken).toBeTruthy();
    const device = database
      .prepare('SELECT id, default_member_id, label FROM device')
      .get() as { id: string; default_member_id: bigint; label: string };
    expect(device).toEqual({
      id: deviceId,
      default_member_id: members[0]?.id,
      label: 'BudgetBuddyTest/1.0',
    });

    const session = database
      .prepare(
        'SELECT token_hash, device_id, member_id, password_epoch, created_at, last_used_at, expires_at FROM session',
      )
      .get() as {
      token_hash: string;
      device_id: string;
      member_id: bigint;
      password_epoch: bigint;
      created_at: bigint;
      last_used_at: bigint;
      expires_at: bigint;
    };
    const tokenHash = createHash('sha256')
      .update(sessionToken ?? '')
      .digest('hex');
    expect(session).toEqual({
      token_hash: tokenHash,
      device_id: deviceId,
      member_id: members[0]?.id,
      password_epoch: 0n,
      created_at: BigInt(fixedNow.getTime()),
      last_used_at: BigInt(fixedNow.getTime()),
      expires_at: BigInt(fixedNow.getTime() + 90 * 24 * 60 * 60 * 1000),
    });
    expect(session.token_hash).not.toBe(sessionToken);
    expect(
      (await app.inject({ method: 'GET', url: '/api/setup' })).json(),
    ).toEqual({ needed: false });
  });

  it('refuses setup after the first family has been created', async () => {
    const payload = {
      password: 'family-password-1',
      passwordConfirmation: 'family-password-1',
      profiles: ['Alex'],
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/setup',
          headers: setupHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(201);

    const secondAttempt = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: setupHeaders,
      payload,
    });
    expect(secondAttempt.statusCode).toBe(403);
    expect(secondAttempt.json()).toEqual({
      error: {
        code: 'forbidden_state',
        message: 'First start has already been completed.',
      },
    });
    const invalidRepeat = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: setupHeaders,
      payload: {
        password: 'short',
        passwordConfirmation: 'different',
        profiles: [],
      },
    });
    expect(invalidRepeat.statusCode).toBe(403);
    expect(invalidRepeat.json()).toMatchObject({
      error: { code: 'forbidden_state' },
    });
    expect(
      (
        database.prepare('SELECT count(*) AS count FROM member').get() as {
          count: bigint;
        }
      ).count,
    ).toBe(1n);
  });

  it.each([
    {
      description: 'a short password',
      password: 'short',
      passwordConfirmation: 'short',
      field: 'password',
      message: 'Use at least 10 characters.',
    },
    {
      description: 'a mismatched confirmation',
      password: 'long-enough-password',
      passwordConfirmation: 'different-password',
      field: 'passwordConfirmation',
      message: 'The passwords do not match.',
    },
  ])(
    'returns a field error for $description',
    async ({ password, passwordConfirmation, field, message }) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/setup',
        headers: setupHeaders,
        payload: { password, passwordConfirmation, profiles: ['Alex'] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: {
          code: 'validation',
          message: 'Check the highlighted fields.',
          fields: { [field]: message },
        },
      });
      expect(database.prepare('SELECT 1 FROM family').get()).toBeUndefined();
      expect(database.prepare('SELECT 1 FROM member').get()).toBeUndefined();
    },
  );

  it('rejects an empty profile name as a field error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: setupHeaders,
      payload: {
        password: 'long-enough-password',
        passwordConfirmation: 'long-enough-password',
        profiles: ['   '],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'validation',
        fields: {
          profiles: 'Enter a profile name.',
        },
      },
    });
    expect(database.prepare('SELECT 1 FROM family').get()).toBeUndefined();
  });

  it('requires at least one profile name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: setupHeaders,
      payload: {
        password: 'long-enough-password',
        passwordConfirmation: 'long-enough-password',
        profiles: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'validation',
        fields: { profiles: expect.any(String) },
      },
    });
    expect(database.prepare('SELECT 1 FROM family').get()).toBeUndefined();
    expect(database.prepare('SELECT 1 FROM member').get()).toBeUndefined();
  });

  it('rejects a foreign origin and a request without JSON content type', async () => {
    const payload = {
      password: 'long-enough-password',
      passwordConfirmation: 'long-enough-password',
      profiles: ['Alex'],
    };
    const foreignOrigin = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...setupHeaders, origin: 'https://evil.example' },
      payload,
    });
    expect(foreignOrigin.statusCode).toBe(403);

    const missingContentType = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { origin: setupOrigin, 'content-type': 'text/plain' },
      payload: JSON.stringify(payload),
    });
    expect(missingContentType.statusCode).toBe(403);
    expect(database.prepare('SELECT 1 FROM family').get()).toBeUndefined();
  });

  it('accepts any configured origin, not only the first', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...setupHeaders, origin: secondOrigin },
      payload: {
        password: 'long-enough-password',
        passwordConfirmation: 'long-enough-password',
        profiles: ['Alex'],
      },
    });
    expect(response.statusCode).toBe(201);
  });

  it('accepts same-origin fetch metadata when Origin is absent', async () => {
    const payload = {
      password: 'long-enough-password',
      passwordConfirmation: 'long-enough-password',
      profiles: ['Alex'],
    };
    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
      },
      payload,
    });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json()).toMatchObject({
      error: { code: 'forbidden_state' },
    });

    const sameOrigin = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
      },
      payload,
    });
    expect(sameOrigin.statusCode).toBe(201);
  });
});
