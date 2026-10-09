import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { balanceAt } from '../src/domain/balance.js';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const fixedTime = new Date('2026-10-08T12:34:56.000Z').getTime();

describe('accounts and snapshots integration', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let temporaryDirectory: string;
  let cookies: string;
  let now: number;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'budget-buddy-accounts-'),
    );
    database = new Database(join(temporaryDirectory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    now = fixedTime;
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock: { now: () => new Date(now) },
    });
    await migrateDatabase(database, {
      backupDir: temporaryDirectory,
      migrationsFolder,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'AccountsTest/1.0' },
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

  it('creates an account with an optional signed opening snapshot attributed to the session profile', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: requestHeaders(),
      payload: {
        name: 'Mortgage',
        type: 'we_owe',
        currency: 'EUR',
        openingBalance: '-198630',
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().account).toMatchObject({
      name: 'Mortgage',
      type: 'we_owe',
      currency: 'EUR',
      balance: '-198630',
      balanceSource: 'opening',
      createdBy: 1,
      updatedBy: 1,
    });
    expect(
      database.prepare('SELECT created_by, updated_by FROM snapshot').get(),
    ).toEqual({ created_by: 1n, updated_by: 1n });

    const invalidDateWithoutAmount = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: requestHeaders(),
      payload: {
        name: 'No opening amount',
        type: 'bank',
        currency: 'EUR',
        openingDate: '2026-10-07',
      },
    });
    expect(invalidDateWithoutAmount.statusCode).toBe(400);
    expect(invalidDateWithoutAmount.json()).toMatchObject({
      error: {
        code: 'validation',
        fields: { openingDate: expect.any(String) },
      },
    });
  });

  it('refuses decimal-point amount strings without creating a snapshot', async () => {
    const accountId = await createAccount();
    const response = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/snapshots`,
      headers: requestHeaders(),
      payload: { amount: '19.86' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'validation',
        fields: { amount: 'Enter a valid amount.' },
      },
    });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM snapshot').get(),
    ).toEqual({ count: 0n });
  });

  it('reports oversized opening and snapshot integer amounts', async () => {
    const oversizedAmounts = [
      '9223372036854775808',
      '10000000000000000000',
    ];

    for (const amount of oversizedAmounts) {
      const opening = await app.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: requestHeaders(),
        payload: {
          name: `Too large ${amount.length}`,
          type: 'bank',
          currency: 'EUR',
          openingBalance: amount,
        },
      });
      expect(opening.statusCode).toBe(400);
      expect(opening.json(), `opening amount ${amount}`).toMatchObject({
        error: {
          code: 'validation',
          message: 'Amount is too large',
          fields: { openingBalance: 'Amount is too large' },
        },
      });
    }
    expect(database.prepare('SELECT COUNT(*) AS count FROM account').get()).toEqual({
      count: 0n,
    });

    const accountId = await createAccount();
    for (const amount of oversizedAmounts) {
      const snapshot = await app.inject({
        method: 'POST',
        url: `/api/accounts/${accountId}/snapshots`,
        headers: requestHeaders(),
        payload: { amount },
      });
      expect(snapshot.statusCode).toBe(400);
      expect(snapshot.json(), `snapshot amount ${amount}`).toMatchObject({
        error: {
          code: 'validation',
          message: 'Amount is too large',
          fields: { amount: 'Amount is too large' },
        },
      });
    }
    expect(database.prepare('SELECT COUNT(*) AS count FROM snapshot').get()).toEqual({
      count: 0n,
    });
  });

  it('blocks account deletion when history exists but deletes an empty account', async () => {
    const accountId = await createAccount({ openingBalance: '2500' });
    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${accountId}`,
      headers: requestHeaders(),
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: 'conflict' } });
    expect(
      database.prepare('SELECT id FROM account WHERE id = ?').get(accountId),
    ).toBeDefined();

    const emptyAccountId = await createAccount();
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${emptyAccountId}`,
      headers: requestHeaders(),
      payload: {},
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
  });

  it('allows deleting an account after its snapshot is deleted despite its revision', async () => {
    const accountId = await createAccount({ openingBalance: '2500' });
    const snapshotId = Number(
      (database.prepare('SELECT id FROM snapshot').get() as { id: bigint }).id,
    );

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/snapshots/${snapshotId}`,
      headers: requestHeaders(),
      payload: {},
    });
    expect(removed.statusCode).toBe(200);
    expect(
      database
        .prepare(
          'SELECT action, old_amount FROM snapshot_revision WHERE snapshot_id = ?',
        )
        .get(snapshotId),
    ).toEqual({ action: 'delete', old_amount: 2500n });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${accountId}`,
      headers: requestHeaders(),
      payload: {},
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
  });

  it('records deactivation time and returns zero from balanceAt at and after it', async () => {
    const accountId = await createAccount({ openingBalance: '7250' });
    const deactivationTime = fixedTime + 60_000;
    now = deactivationTime;
    const response = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/deactivate`,
      headers: requestHeaders(),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().account).toMatchObject({
      active: false,
      deactivatedAt: deactivationTime,
      balance: '0',
    });
    expect(
      balanceAt(database, deactivationTime + 1, {
        accountIds: [accountId],
      })[0]?.balance,
    ).toBe(0n);
    expect(
      balanceAt(database, deactivationTime - 1, {
        accountIds: [accountId],
      })[0]?.balance,
    ).toBe(7250n);

    now = deactivationTime + 60_000;
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/deactivate`,
      headers: requestHeaders(),
      payload: {},
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().account.deactivatedAt).toBe(deactivationTime);
    expect(
      database
        .prepare('SELECT deactivated_at FROM account WHERE id = ?')
        .get(accountId),
    ).toEqual({ deactivated_at: BigInt(deactivationTime) });
  });

  it('creates a revision with the previous value and active profile on correction', async () => {
    await createAccount({ openingBalance: '12345' });
    const snapshotId = Number(
      (database.prepare('SELECT id FROM snapshot').get() as { id: bigint }).id,
    );
    now = fixedTime + 10_000;

    const selectedProfile = await app.inject({
      method: 'POST',
      url: '/api/auth/profile',
      headers: requestHeaders(),
      payload: { memberId: 2, remember: false },
    });
    expect(selectedProfile.statusCode).toBe(200);
    expect(selectedProfile.json().member).toEqual({ id: 2, name: 'Blair' });

    const corrected = await app.inject({
      method: 'PATCH',
      url: `/api/snapshots/${snapshotId}`,
      headers: requestHeaders(),
      payload: { amount: '54321' },
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().snapshot).toMatchObject({
      amount: '54321',
      updatedBy: 2,
    });
    expect(
      database
        .prepare(
          'SELECT action, old_amount, changed_by FROM snapshot_revision WHERE snapshot_id = ?',
        )
        .get(snapshotId),
    ).toEqual({ action: 'update', old_amount: 12345n, changed_by: 2n });
    expect(
      database
        .prepare('SELECT updated_by FROM snapshot WHERE id = ?')
        .get(snapshotId),
    ).toEqual({ updated_by: 2n });

    const invalidCorrection = await app.inject({
      method: 'PATCH',
      url: `/api/snapshots/${snapshotId}`,
      headers: requestHeaders(),
      payload: { amount: '54.321' },
    });
    expect(invalidCorrection.statusCode).toBe(400);
    expect(
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM snapshot_revision WHERE snapshot_id = ?',
        )
        .get(snapshotId),
    ).toEqual({ count: 1n });

    const revisions = await app.inject({
      method: 'GET',
      url: `/api/snapshots/${snapshotId}/revisions`,
      headers: { cookie: cookies },
    });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json().revisions[0]).toMatchObject({
      oldAmount: '12345',
      changedBy: 2,
      changedByName: 'Blair',
    });
  });

  it('previews and confirms EUR to JPY relabelling with the example and rounding loss', async () => {
    const accountId = await createAccount({ openingBalance: '198630' });
    const snapshotId = Number(
      (database.prepare('SELECT id FROM snapshot').get() as { id: bigint }).id,
    );
    const revisedDate = await app.inject({
      method: 'PATCH',
      url: `/api/snapshots/${snapshotId}`,
      headers: requestHeaders(),
      payload: { date: '2026-10-07' },
    });
    expect(revisedDate.statusCode).toBe(200);
    expect(
      database
        .prepare(
          'SELECT id, old_amount FROM snapshot_revision WHERE snapshot_id = ?',
        )
        .get(snapshotId),
    ).toMatchObject({ old_amount: 198630n });
    const revisionId = Number(
      (
        database
          .prepare('SELECT id FROM snapshot_revision WHERE snapshot_id = ?')
          .get(snapshotId) as { id: bigint }
      ).id,
    );

    const preview = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/currency`,
      headers: requestHeaders(),
      payload: { currency: 'JPY' },
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      accountId,
      fromCurrency: 'EUR',
      toCurrency: 'JPY',
      requiresConfirmation: true,
      example: {
        beforeAmount: '198630',
        afterAmount: '1986',
      },
      precisionLosses: [
        {
          recordType: 'snapshot',
          recordId: snapshotId,
          snapshotId,
          revisionId: null,
          beforeAmount: '198630',
          afterAmount: '1986',
        },
        {
          recordType: 'revision',
          recordId: revisionId,
          snapshotId,
          revisionId,
          beforeAmount: '198630',
          afterAmount: '1986',
        },
      ],
    });
    expect(
      (
        database
          .prepare('SELECT currency FROM account WHERE id = ?')
          .get(accountId) as { currency: string }
      ).currency,
    ).toBe('EUR');

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/currency`,
      headers: requestHeaders(),
      payload: { currency: 'JPY', confirm: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().requiresConfirmation).toBe(false);
    expect(
      database
        .prepare('SELECT currency FROM account WHERE id = ?')
        .get(accountId),
    ).toEqual({ currency: 'JPY' });
    expect(database.prepare('SELECT amount FROM snapshot').get()).toEqual({
      amount: 1986n,
    });
    expect(
      database
        .prepare(
          'SELECT old_amount FROM snapshot_revision WHERE snapshot_id = ?',
        )
        .get(snapshotId),
    ).toEqual({ old_amount: 1986n });

    const unknownCurrency = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/currency`,
      headers: requestHeaders(),
      payload: { currency: 'ZZZ' },
    });
    expect(unknownCurrency.statusCode).toBe(400);
  });

  it('does not reuse a deleted greatest snapshot ID or expose its revision history', async () => {
    const accountId = await createAccount({ openingBalance: '1000' });
    const second = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/snapshots`,
      headers: requestHeaders(),
      payload: { amount: '2000' },
    });
    expect(second.statusCode).toBe(201);
    const deletedId = second.json().snapshot.id as number;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/snapshots/${deletedId}`,
      headers: requestHeaders(),
      payload: {},
    });
    expect(deleted.statusCode).toBe(200);

    const inserted = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/snapshots`,
      headers: requestHeaders(),
      payload: { amount: '3000' },
    });
    expect(inserted.statusCode).toBe(201);
    const insertedId = inserted.json().snapshot.id as number;
    expect(insertedId).toBeGreaterThan(deletedId);

    const newHistory = await app.inject({
      method: 'GET',
      url: `/api/snapshots/${insertedId}/revisions`,
      headers: { cookie: cookies },
    });
    expect(newHistory.statusCode).toBe(200);
    expect(newHistory.json().revisions).toEqual([]);
    expect(
      database
        .prepare(
          'SELECT action, old_amount FROM snapshot_revision WHERE snapshot_id = ?',
        )
        .get(deletedId),
    ).toEqual({ action: 'delete', old_amount: 2000n });
  });

  it('lists 40 accounts with balances using one account-and-snapshot query', async () => {
    for (let index = 0; index < 40; index += 1) {
      const accountId = await createAccount({ name: `Account ${index}` });
      if (index % 2 === 0) {
        database
          .prepare(
            `INSERT INTO snapshot
               (account_id, taken_at, amount, source, created_by, created_at,
                updated_by, updated_at)
             VALUES (?, ?, ?, 'manual', 1, ?, 1, ?)`,
          )
          .run(accountId, fixedTime, BigInt(index), fixedTime, fixedTime);
      }
    }

    const accountSnapshotQueries: string[] = [];
    const originalPrepare = database.prepare.bind(database);
    database.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (
        !/\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+["`']?(?:account|snapshot)\b/iu.test(
          sql,
        )
      ) {
        return statement;
      }
      return new Proxy(statement, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (!['all', 'get', 'run', 'iterate'].includes(String(property)))
            return value;
          return (...parameters: unknown[]) => {
            accountSnapshotQueries.push(sql);
            return Reflect.apply(
              value as (...args: unknown[]) => unknown,
              target,
              parameters,
            );
          };
        },
      });
    }) as Database.Database['prepare'];
    const response = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { cookie: cookies },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accounts).toHaveLength(40);
    expect(accountSnapshotQueries).toHaveLength(1);
    expect(
      response
        .json()
        .accounts.find(
          (account: { name: string }) => account.name === 'Account 1',
        ),
    ).toMatchObject({ balance: '0', balanceSource: null });
  });

  it('uses source precedence for same-time snapshots in balanceAt and account listing', async () => {
    const accountId = await createAccount();
    insertSnapshot(accountId, fixedTime, 900, 'connector');
    insertSnapshot(accountId, fixedTime, 200, 'manual');

    expect(
      balanceAt(database, fixedTime, { accountIds: [accountId] })[0],
    ).toMatchObject({
      balance: 900n,
      source: 'connector',
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { cookie: cookies },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed
        .json()
        .accounts.find((account: { id: number }) => account.id === accountId),
    ).toMatchObject({ balance: '900', balanceSource: 'connector' });
  });

  it('prefers checkin over carried_forward at the same instant', async () => {
    const accountId = await createAccount();
    const firstCheckin = Number(
      database
        .prepare('INSERT INTO checkin (opened_at, closed_at) VALUES (?, ?)')
        .run(fixedTime, fixedTime).lastInsertRowid,
    );
    const secondCheckin = Number(
      database
        .prepare('INSERT INTO checkin (opened_at, closed_at) VALUES (?, ?)')
        .run(fixedTime, fixedTime).lastInsertRowid,
    );
    insertSnapshot(accountId, fixedTime, 800, 'checkin', secondCheckin);
    insertSnapshot(accountId, fixedTime, 100, 'carried_forward', firstCheckin);

    expect(
      balanceAt(database, fixedTime, { accountIds: [accountId] })[0],
    ).toMatchObject({
      balance: 800n,
      source: 'checkin',
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { cookie: cookies },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed
        .json()
        .accounts.find((account: { id: number }) => account.id === accountId),
    ).toMatchObject({ balance: '800', balanceSource: 'checkin' });
  });

  it('enforces global uniqueness of non-null source_ref and external_id pairs', async () => {
    const firstAccountId = await createAccount();
    const secondAccountId = await createAccount({ name: 'Second account' });
    insertSnapshot(
      firstAccountId,
      fixedTime,
      10,
      'connector',
      undefined,
      'bank-feed',
      'row-1',
    );

    expect(() =>
      insertSnapshot(
        secondAccountId,
        fixedTime,
        11,
        'connector',
        undefined,
        'bank-feed',
        'row-1',
      ),
    ).toThrow();
    expect(
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM snapshot WHERE source_ref = ? AND external_id = ?',
        )
        .get('bank-feed', 'row-1'),
    ).toEqual({ count: 1n });
  });

  function requestHeaders() {
    return { ...jsonHeaders, cookie: cookies };
  }

  async function createAccount(
    options: {
      name?: string;
      openingBalance?: string;
      currency?: string;
    } = {},
  ): Promise<number> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: requestHeaders(),
      payload: {
        name: options.name ?? 'Test account',
        type: 'bank',
        currency: options.currency ?? 'EUR',
        ...(options.openingBalance === undefined
          ? {}
          : { openingBalance: options.openingBalance }),
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().account.id as number;
  }

  function insertSnapshot(
    accountId: number,
    takenAt: number,
    amount: number,
    source: string,
    checkinId?: number,
    sourceRef?: string,
    externalId?: string,
  ) {
    return database
      .prepare(
        `INSERT INTO snapshot
           (account_id, taken_at, amount, source, checkin_id, source_ref, external_id,
            created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?)`,
      )
      .run(
        accountId,
        takenAt,
        amount,
        source,
        checkinId ?? null,
        sourceRef ?? null,
        externalId ?? null,
        fixedTime,
        fixedTime,
      );
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
