import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createCheckinEventBus, type CheckinEvents } from '../src/events.js';
import { migrateDatabase } from '../src/db/migrate.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const fixedTime = new Date('2026-10-08T12:34:56.000Z').getTime();

describe('check-in integration', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let temporaryDirectory: string;
  let cookies: string;
  let now: number;
  let events: CheckinEvents[keyof CheckinEvents][];

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'budget-buddy-checkins-'),
    );
    database = new Database(join(temporaryDirectory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    now = fixedTime;
    events = [];
    const eventBus = createCheckinEventBus();
    eventBus.on('checkin.opened', (event) => {
      events.push(event);
    });
    eventBus.on('checkin.closed', (event) => {
      events.push(event);
    });
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock: { now: () => new Date(now) },
      events: eventBus,
    });
    await migrateDatabase(database, {
      backupDir: temporaryDirectory,
      migrationsFolder,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'CheckinsTest/1.0' },
      payload: {
        password: 'correct horse battery staple',
        passwordConfirmation: 'correct horse battery staple',
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(setup.statusCode).toBe(201);
    cookies = sessionCookies(setup);
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('joins the one open check-in across concurrent starts and emits once', async () => {
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/checkins',
        headers: requestHeaders(),
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: '/api/checkins',
        headers: requestHeaders(),
        payload: {},
      }),
    ]);

    expect(
      [first.statusCode, second.statusCode].sort(),
      [first.body, second.body].join(', '),
    ).toEqual([200, 201]);
    expect(first.json().checkin.id).toBe(second.json().checkin.id);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM checkin').get(),
    ).toEqual({
      count: 1n,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      checkinId: first.json().checkin.id,
      openedBy: 1,
    });
  });

  it('saves Same as a fresh snapshot and revisions when replacing a value', async () => {
    const accountId = await createAccount({ openingBalance: '12345' });
    await createAccount({ name: 'Other account' });
    const checkinId = await start();

    const same = await app.inject({
      method: 'PUT',
      url: `/api/checkins/${checkinId}/values/${accountId}`,
      headers: requestHeaders(),
      payload: { same: true },
    });
    expect(same.statusCode).toBe(200);
    expect(
      database
        .prepare(
          'SELECT amount, source, checkin_id FROM snapshot WHERE account_id = ? AND checkin_id = ?',
        )
        .get(accountId, checkinId),
    ).toEqual({
      amount: 12345n,
      source: 'checkin',
      checkin_id: BigInt(checkinId),
    });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/checkins/${checkinId}/values/${accountId}`,
      headers: requestHeaders(),
      payload: { amount: '54321' },
    });
    expect(updated.statusCode).toBe(200);
    expect(
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM snapshot WHERE account_id = ? AND checkin_id = ?',
        )
        .get(accountId, checkinId),
    ).toEqual({ count: 1n });
    expect(
      database
        .prepare(
          'SELECT old_amount, changed_by FROM snapshot_revision WHERE account_id = ?',
        )
        .get(accountId),
    ).toEqual({ old_amount: 12345n, changed_by: 1n });
  });

  it('auto-closes with no closer when the last active account is entered', async () => {
    const firstAccount = await createAccount({
      name: 'First',
      openingBalance: '10',
    });
    const secondAccount = await createAccount({
      name: 'Second',
      openingBalance: '20',
    });
    const checkinId = await start();

    const firstValue = await saveValue(checkinId, firstAccount, '11');
    expect(firstValue.json().checkin).toMatchObject({
      totalAccounts: 2,
      completedAccounts: 1,
      closedAt: null,
    });
    expect(firstValue.json().checkin.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 1,
          accounts: 2,
          completed: 1,
          done: false,
        }),
      ]),
    );
    const lastValue = await saveValue(checkinId, secondAccount, '21');
    expect(lastValue.statusCode).toBe(200);
    expect(lastValue.json().checkin).toMatchObject({
      completedAccounts: 2,
      closedAt: fixedTime,
      closedBy: null,
    });
    expect(
      database
        .prepare('SELECT closed_by FROM checkin WHERE id = ?')
        .get(checkinId),
    ).toEqual({ closed_by: null });
    expect(events.at(-1)).toMatchObject({
      closedAt: fixedTime,
      closedBy: null,
    });

    const rejected = await saveValue(checkinId, secondAccount, '22');
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({
      error: { code: 'forbidden_state' },
    });
  });

  it('carries forward only missing active accounts at Close now', async () => {
    const firstAccount = await createAccount({
      name: 'First',
      openingBalance: '100',
    });
    const secondAccount = await createAccount({
      name: 'Second',
      openingBalance: '200',
    });
    const thirdAccount = await createAccount({
      name: 'Third',
      openingBalance: '300',
    });
    const checkinId = await start();
    await saveValue(checkinId, firstAccount, '110');
    now += 5_000;

    const closed = await app.inject({
      method: 'POST',
      url: `/api/checkins/${checkinId}/close`,
      headers: requestHeaders(),
      payload: {},
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().checkin).toMatchObject({
      closedAt: now,
      closedBy: { memberId: 1, name: 'Alex' },
      totalAccounts: 3,
      completedAccounts: 3,
    });
    const values = database
      .prepare(
        'SELECT account_id, amount, source, taken_at FROM snapshot WHERE checkin_id = ? ORDER BY account_id',
      )
      .all(checkinId);
    expect(values).toEqual([
      {
        account_id: BigInt(firstAccount),
        amount: 110n,
        source: 'checkin',
        taken_at: BigInt(fixedTime),
      },
      {
        account_id: BigInt(secondAccount),
        amount: 200n,
        source: 'carried_forward',
        taken_at: BigInt(now),
      },
      {
        account_id: BigInt(thirdAccount),
        amount: 300n,
        source: 'carried_forward',
        taken_at: BigInt(now),
      },
    ]);
    expect(events.at(-1)).toMatchObject({ closedAt: now, closedBy: 1 });
  });

  it('updates required accounts dynamically and reports each profile progress', async () => {
    const alex = await createAccount({
      name: 'Alex account',
      ownerMemberId: 1,
    });
    const blair = await createAccount({
      name: 'Blair account',
      ownerMemberId: 2,
    });
    const checkinId = await start();
    const createdDuring = await createAccount({ name: 'Added while open' });

    const current = await app.inject({
      method: 'GET',
      url: `/api/checkins/${checkinId}`,
      headers: { cookie: cookies },
    });
    expect(current.json().checkin).toMatchObject({
      totalAccounts: 3,
      members: [
        { memberId: 1, accounts: 2, completed: 0, done: false },
        { memberId: 2, accounts: 1, completed: 0, done: false },
      ],
      needsAccounts: false,
    });
    await saveValue(checkinId, alex, '1');
    const partialProgress = await app.inject({
      method: 'GET',
      url: `/api/checkins/${checkinId}`,
      headers: { cookie: cookies },
    });
    expect(partialProgress.json().checkin.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 1,
          accounts: 2,
          completed: 1,
          done: false,
        }),
        expect.objectContaining({
          memberId: 2,
          accounts: 1,
          completed: 0,
          done: false,
        }),
      ]),
    );
    await saveValue(checkinId, blair, '2');
    const deactivated = await app.inject({
      method: 'POST',
      url: `/api/accounts/${createdDuring}/deactivate`,
      headers: requestHeaders(),
      payload: {},
    });
    expect(deactivated.statusCode).toBe(200);
    const done = await saveValue(checkinId, createdDuring, '3');
    expect(done.statusCode).toBe(403);
    const afterDeactivation = await app.inject({
      method: 'GET',
      url: '/api/checkins/current',
      headers: { cookie: cookies },
    });
    expect(afterDeactivation.json().checkin).toMatchObject({
      totalAccounts: 2,
      completedAccounts: 2,
      closedAt: null,
    });
    await saveValue(checkinId, alex, '1');
    const progress = await app.inject({
      method: 'GET',
      url: `/api/checkins/${checkinId}`,
      headers: { cookie: cookies },
    });
    expect(progress.json().checkin).toMatchObject({
      totalAccounts: 2,
      completedAccounts: 2,
      closedAt: fixedTime,
    });
  });

  it('marks a profile with no active accounts as needing one', async () => {
    await createAccount({ name: 'Blair only', ownerMemberId: 2 });
    const checkinId = await start();
    const response = await app.inject({
      method: 'GET',
      url: `/api/checkins/${checkinId}`,
      headers: { cookie: cookies },
    });
    expect(response.json().checkin).toMatchObject({
      needsAccounts: true,
      members: [
        { memberId: 1, name: 'Alex', accounts: 0, completed: 0, done: true },
        { memberId: 2, name: 'Blair', accounts: 1, completed: 0, done: false },
      ],
    });
  });

  async function start(): Promise<number> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: requestHeaders(),
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    return response.json().checkin.id as number;
  }

  async function saveValue(
    checkinId: number,
    accountId: number,
    amount: string,
  ) {
    return app.inject({
      method: 'PUT',
      url: `/api/checkins/${checkinId}/values/${accountId}`,
      headers: requestHeaders(),
      payload: { amount },
    });
  }

  async function createAccount(
    options: {
      name?: string;
      openingBalance?: string;
      ownerMemberId?: number;
    } = {},
  ): Promise<number> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: requestHeaders(),
      payload: {
        name: options.name ?? 'Test account',
        ownerMemberId: options.ownerMemberId ?? 1,
        type: 'bank',
        currency: 'EUR',
        ...(options.openingBalance === undefined
          ? {}
          : { openingBalance: options.openingBalance }),
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().account.id as number;
  }

  function requestHeaders() {
    return { ...jsonHeaders, cookie: cookies };
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
