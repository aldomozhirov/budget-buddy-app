import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };

describe('members and family password integration', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'budget-buddy-members-'));
    database = new Database(join(temporaryDirectory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, {
      backupDir: temporaryDirectory,
      migrationsFolder,
    });
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('adds, renames, deactivates, and reactivates profiles while refusing an active duplicate name', async () => {
    const setup = await createFamily(['Alex', 'Blair']);
    const cookies = sessionCookies(setup);
    const headers = { cookie: cookies };

    const listed = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().members).toEqual([
      { id: 1, name: 'Alex', active: true },
      { id: 2, name: 'Blair', active: true },
    ]);

    const added = await app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: { name: 'Casey' },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toEqual({
      member: { id: 3, name: 'Casey', active: true },
    });

    const renamed = await app.inject({
      method: 'PATCH',
      url: '/api/members/3',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: { name: 'Jordan' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().member).toEqual({
      id: 3,
      name: 'Jordan',
      active: true,
    });

    const duplicateRename = await app.inject({
      method: 'PATCH',
      url: '/api/members/1',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: { name: 'bLAIR' },
    });
    expect(duplicateRename.statusCode).toBe(409);
    expect(duplicateRename.json()).toMatchObject({
      error: {
        code: 'conflict',
        fields: { name: 'A profile with that name is already active.' },
      },
    });
    expect(
      database.prepare('SELECT name FROM member WHERE id = 1').get(),
    ).toEqual({ name: 'Alex' });

    const deactivated = await app.inject({
      method: 'PATCH',
      url: '/api/members/2',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: { active: false },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().member).toEqual({
      id: 2,
      name: 'Blair',
      active: false,
    });
    expect(
      database.prepare('SELECT deactivated_at FROM member WHERE id = 2').get(),
    ).toMatchObject({ deactivated_at: expect.any(BigInt) });

    const currentSession = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers,
    });
    expect(currentSession.statusCode).toBe(200);
    expect(currentSession.json().profiles).toEqual([
      { id: 1, name: 'Alex' },
      { id: 3, name: 'Jordan' },
    ]);

    const reactivated = await app.inject({
      method: 'PATCH',
      url: '/api/members/2',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: { active: true },
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().member).toEqual({
      id: 2,
      name: 'Blair',
      active: true,
    });
    expect(
      database.prepare('SELECT deactivated_at FROM member WHERE id = 2').get(),
    ).toEqual({ deactivated_at: null });
  });

  it('does not allow deactivating the last active profile', async () => {
    const setup = await createFamily(['Only']);
    const cookies = sessionCookies(setup);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/members/1',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: { active: false },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'conflict',
        message: 'At least one profile must stay active.',
      },
    });
    expect(
      database.prepare('SELECT active FROM member WHERE id = 1').get(),
    ).toEqual({ active: 1n });
  });

  it('changes the family password, keeps the current session, and revokes other sessions and passkeys', async () => {
    const setup = await createFamily(['Alex']);
    const currentCookies = sessionCookies(setup);
    const otherSignIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: jsonHeaders,
      payload: { password: 'correct family password' },
    });
    expect(otherSignIn.statusCode).toBe(200);
    const otherCookies = sessionCookies(otherSignIn);
    const currentDevice = cookieValue(currentCookies, 'bb_device');
    const otherDevice = cookieValue(otherCookies, 'bb_device');
    database
      .prepare(
        'INSERT INTO passkey (device_id, credential_id, public_key, counter, created_at) VALUES (?, ?, ?, 0, 1)',
      )
      .run(currentDevice, 'current-passkey', 'current-public-key');
    database
      .prepare(
        'INSERT INTO passkey (device_id, credential_id, public_key, counter, created_at) VALUES (?, ?, ?, 0, 1)',
      )
      .run(otherDevice, 'other-passkey', 'other-public-key');

    const invalidCurrentPassword = await app.inject({
      method: 'PUT',
      url: '/api/family/password',
      headers: { ...jsonHeaders, cookie: currentCookies },
      payload: {
        currentPassword: 'not the current password',
        newPassword: 'a new family password',
      },
    });
    expect(invalidCurrentPassword.statusCode).toBe(400);
    expect(invalidCurrentPassword.json()).toMatchObject({
      error: {
        fields: { currentPassword: 'The current password doesn’t match.' },
      },
    });

    const shortNewPassword = await app.inject({
      method: 'PUT',
      url: '/api/family/password',
      headers: { ...jsonHeaders, cookie: currentCookies },
      payload: {
        currentPassword: 'correct family password',
        newPassword: 'too short',
      },
    });
    expect(shortNewPassword.statusCode).toBe(400);
    expect(shortNewPassword.json()).toMatchObject({
      error: { fields: { newPassword: 'Use at least 10 characters.' } },
    });

    const changed = await app.inject({
      method: 'PUT',
      url: '/api/family/password',
      headers: { ...jsonHeaders, cookie: currentCookies },
      payload: {
        currentPassword: 'correct family password',
        newPassword: 'new family password 2026',
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ changed: true });

    const currentSessionStillWorks = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: currentCookies },
    });
    expect(currentSessionStillWorks.statusCode).toBe(200);
    expect(currentSessionStillWorks.json().member).toEqual({
      id: 1,
      name: 'Alex',
    });

    const otherSessionRevoked = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: otherCookies },
    });
    expect(otherSessionRevoked.statusCode).toBe(401);
    expect(otherSessionRevoked.json().error.code).toBe('unauthenticated');
    expect(
      database.prepare('SELECT count(*) AS count FROM session').get(),
    ).toEqual({ count: 1n });
    expect(
      database.prepare('SELECT device_id, credential_id FROM passkey').all(),
    ).toEqual([{ device_id: currentDevice, credential_id: 'current-passkey' }]);

    const oldPasswordSignIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: jsonHeaders,
      payload: { password: 'correct family password' },
    });
    expect(oldPasswordSignIn.statusCode).toBe(401);
    const newPasswordSignIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: jsonHeaders,
      payload: { password: 'new family password 2026' },
    });
    expect(newPasswordSignIn.statusCode).toBe(200);
  });

  async function createFamily(profiles: string[]) {
    const password = 'correct family password';
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'MembersIntegrationTest/1.0' },
      payload: {
        password,
        passwordConfirmation: password,
        profiles,
      },
    });
    expect(response.statusCode).toBe(201);
    return response;
  }
});

function sessionCookies(response: {
  headers: Record<string, unknown>;
}): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}

function cookieValue(cookies: string, name: string): string {
  const value = cookies
    .split('; ')
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!value) throw new Error(`Missing ${name} cookie`);
  return decodeURIComponent(value);
}
