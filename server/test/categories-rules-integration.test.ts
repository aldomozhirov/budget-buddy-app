import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

/** The category and rule routes of spec 2 task 4 (CAT-1 to CAT-3, CAT-6). */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

describe('categories and rules API', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let alex: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-categories-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    now = Date.parse('2026-10-15T10:00:00.000Z');
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock: { now: () => new Date(now) },
    });
    await migrateDatabase(database, {
      backupDir: directory,
      migrationsFolder,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'Alex-iPhone/1.0' },
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(setup.statusCode).toBe(201);
    alex = cookieHeader(setup);
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
    cookie = alex,
  ) {
    return app.inject({
      method,
      url,
      headers: { ...jsonHeaders, cookie },
      ...(method === 'GET' ? {} : { payload: payload ?? {} }),
    });
  }

  /** Creates a category through the API and returns its id. */
  async function createCategory(
    name: string,
    kind: 'expense' | 'income' = 'expense',
    extra: object = {},
  ): Promise<number> {
    const response = await call('POST', '/api/categories', {
      name,
      kind,
      ...extra,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().category.id;
  }

  async function createEnvelope(name = 'Groceries'): Promise<number> {
    const response = await call('POST', '/api/envelopes', {
      name,
      currency: 'EUR',
      monthlyAmount: '40000',
      mode: 'carry_over',
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().envelope.id;
  }

  async function createRule(body: object): Promise<number> {
    const response = await call('POST', '/api/rules', body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().rule.id;
  }

  /** The ids of the rules in list order. */
  async function ruleIds(): Promise<number[]> {
    const listed = await call('GET', '/api/rules');
    return listed.json().rules.map((rule: { id: number }) => rule.id);
  }

  /** The positions of the rules, in list order. */
  async function rulePositions(): Promise<number[]> {
    const listed = await call('GET', '/api/rules');
    return listed
      .json()
      .rules.map((rule: { position: number }) => rule.position);
  }

  function insertAccount(): number {
    const inserted = database
      .prepare(
        `INSERT INTO account (name, type, currency, created_by, created_at,
           updated_by, updated_at) VALUES ('Joint', 'bank', 'EUR', 1, 1, 1, 1)`,
      )
      .run();
    return Number(inserted.lastInsertRowid);
  }

  /** Adds a transaction with one part in the category, directly. */
  function spend(categoryId: number, date: string, status = 'confirmed') {
    const accountId = insertAccount();
    const txn = database
      .prepare(
        `INSERT INTO txn (kind, status, date, account_id, amount, merchant,
           member_id, created_by, created_at, updated_by, updated_at)
         VALUES ('expense', ?, ?, ?, 1000, 'REWE', 1, 1, 1, 1, 1)`,
      )
      .run(status, date, accountId);
    database
      .prepare(
        `INSERT INTO txn_part (txn_id, position, amount, category_id)
         VALUES (?, 1, 1000, ?)`,
      )
      .run(txn.lastInsertRowid, categoryId);
  }

  it('lists the starter categories in order, active and archived', async () => {
    const response = await call('GET', '/api/categories');
    expect(response.statusCode).toBe(200);
    const { categories } = response.json();
    expect(categories).toHaveLength(16);
    expect(categories[0]).toMatchObject({
      name: 'Groceries',
      kind: 'expense',
      position: 1,
      archived: false,
      used: false,
      usedThisYear: 0,
      ruleCount: 0,
      createdBy: null,
    });
    expect(categories[15]).toMatchObject({
      name: 'Other income',
      position: 16,
    });

    const income = await call('GET', '/api/categories?kind=income');
    expect(
      income.json().categories.map((c: { name: string }) => c.name),
    ).toEqual(['Salary', 'Other income']);
    const bad = await call('GET', '/api/categories?kind=cash');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation');
  });

  it('creates a category last in the list and stores the profile', async () => {
    const blair = await signIn(2);
    const response = await call(
      'POST',
      '/api/categories',
      { name: '  Pets ', kind: 'expense' },
      blair,
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().category).toMatchObject({
      name: 'Pets',
      kind: 'expense',
      position: 17,
      defaultEnvelopeId: null,
      archived: false,
      createdBy: 2,
    });
    const income = await createCategory('Gifts received', 'income');
    const listed = await call('GET', '/api/categories?kind=income');
    expect(listed.json().categories.at(-1)).toMatchObject({
      id: income,
      position: 18,
    });
  });

  it('refuses a duplicate name in another case, archived ones included', async () => {
    const clash = await call('POST', '/api/categories', {
      name: 'GROCERIES',
      kind: 'expense',
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('conflict');
    expect(clash.json().error.fields.name).toBe(
      'A category with that name already exists.',
    );
    // Umlauts fold too, and the same name of the other kind is fine.
    const id = await createCategory('Bäckerei');
    expect(
      (
        await call('POST', '/api/categories', {
          name: 'BÄCKEREI',
          kind: 'expense',
        })
      ).statusCode,
    ).toBe(409);
    expect((await createCategory('Bäckerei', 'income')) > id).toBe(true);

    await call('PATCH', `/api/categories/${id}`, { archived: true });
    const archived = await call('POST', '/api/categories', {
      name: 'bäckerei',
      kind: 'expense',
    });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.fields.name).toBe(
      'An archived category has this name. Restore it instead.',
    );
  });

  it('refuses renaming to an existing name, also an archived one', async () => {
    const pets = await createCategory('Pets');
    const archived = await createCategory('Old');
    await call('PATCH', `/api/categories/${archived}`, { archived: true });

    const toActive = await call('PATCH', `/api/categories/${pets}`, {
      name: 'eating OUT',
    });
    expect(toActive.statusCode).toBe(409);
    const toArchived = await call('PATCH', `/api/categories/${pets}`, {
      name: 'OLD',
    });
    expect(toArchived.statusCode).toBe(409);
    expect(toArchived.json().error.fields.name).toContain('Restore it');
    // Its own name in another case is a rename, not a clash.
    const own = await call('PATCH', `/api/categories/${pets}`, {
      name: 'PETS',
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().category.name).toBe('PETS');
  });

  it('refuses a default envelope on an income category', async () => {
    const envelope = await createEnvelope();
    const created = await call('POST', '/api/categories', {
      name: 'Bonus',
      kind: 'income',
      defaultEnvelopeId: envelope,
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().error.fields.defaultEnvelopeId).toBeTruthy();

    const salary = await createCategory('Pension', 'income');
    const patched = await call('PATCH', `/api/categories/${salary}`, {
      defaultEnvelopeId: envelope,
    });
    expect(patched.statusCode).toBe(400);
    expect(patched.json().error.code).toBe('validation');
    // Clearing it is fine, and nothing was stored.
    const cleared = await call('PATCH', `/api/categories/${salary}`, {
      defaultEnvelopeId: null,
    });
    expect(cleared.statusCode).toBe(200);
  });

  it('sets, clears and validates the default envelope of an expense category', async () => {
    const envelope = await createEnvelope();
    const id = await createCategory('Pets', 'expense', {
      defaultEnvelopeId: envelope,
    });
    const read = await call('GET', '/api/categories?kind=expense');
    expect(
      read.json().categories.find((c: { id: number }) => c.id === id),
    ).toMatchObject({ defaultEnvelopeId: envelope });

    expect(
      (await call('PATCH', `/api/categories/${id}`, { defaultEnvelopeId: 999 }))
        .statusCode,
    ).toBe(400);
    await call('PATCH', `/api/envelopes/${envelope}`, { archived: true });
    const archivedTarget = await call('PATCH', `/api/categories/${id}`, {
      defaultEnvelopeId: envelope,
    });
    expect(archivedTarget.statusCode).toBe(400);
    expect(archivedTarget.json().error.fields.defaultEnvelopeId).toBeTruthy();
    const cleared = await call('PATCH', `/api/categories/${id}`, {
      defaultEnvelopeId: null,
    });
    expect(cleared.json().category.defaultEnvelopeId).toBeNull();
  });

  it('refuses an empty change, an empty name and a kind change', async () => {
    const id = await createCategory('Pets');
    for (const payload of [{}, { name: '  ' }, { kind: 'income' }]) {
      const response = await call('PATCH', `/api/categories/${id}`, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(
      (await call('PATCH', '/api/categories/999', { name: 'X' })).statusCode,
    ).toBe(404);
  });

  it('counts use this year and keeps a used category from being deleted', async () => {
    const id = await createCategory('Pets');
    spend(id, '2026-03-01');
    spend(id, '2026-09-30');
    spend(id, '2025-12-31');
    spend(id, '2026-05-05', 'draft');
    const listed = await call('GET', '/api/categories?kind=expense');
    expect(
      listed.json().categories.find((c: { id: number }) => c.id === id),
    ).toMatchObject({ used: true, usedThisYear: 2 });

    const deleted = await call('DELETE', `/api/categories/${id}`);
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error.code).toBe('conflict');

    // It can be archived and restored, and renamed meanwhile.
    const archived = await call('PATCH', `/api/categories/${id}`, {
      archived: true,
      name: 'Pets and vets',
    });
    expect(archived.json().category).toMatchObject({
      archived: true,
      name: 'Pets and vets',
    });
    expect(archived.json().category.archivedAt).toBe(now);
    const again = await call('PATCH', `/api/categories/${id}`, {
      archived: true,
    });
    expect(again.json().category.archivedAt).toBe(now);
    const restored = await call('PATCH', `/api/categories/${id}`, {
      archived: false,
    });
    expect(restored.json().category).toMatchObject({
      archived: false,
      archivedAt: null,
    });
  });

  it('deletes an unused category with its rules and says how many', async () => {
    const keep = await createCategory('Keep');
    const pets = await createCategory('Pets');
    const envelope = await createEnvelope();
    database
      .prepare('UPDATE envelope SET default_category_id = ? WHERE id = ?')
      .run(pets, envelope);
    const a = await createRule({ pattern: 'ZOO', categoryId: pets });
    const b = await createRule({ pattern: 'REWE', categoryId: keep });
    const c = await createRule({ pattern: 'VET', categoryId: pets });
    expect(await rulePositions()).toEqual([1, 2, 3]);

    const response = await call('DELETE', `/api/categories/${pets}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true, deletedRules: 2 });
    expect(await ruleIds()).toEqual([b]);
    expect(await rulePositions()).toEqual([1]);
    expect(a).not.toBe(c);
    const stored = database
      .prepare('SELECT default_category_id AS d FROM envelope WHERE id = ?')
      .get(envelope);
    expect(stored).toEqual({ d: null });
    expect(
      (await call('GET', '/api/categories'))
        .json()
        .categories.map((x: { id: number }) => x.id),
    ).not.toContain(pets);

    expect((await call('DELETE', `/api/categories/${pets}`)).statusCode).toBe(
      404,
    );
    const none = await createCategory('Empty');
    expect((await call('DELETE', `/api/categories/${none}`)).json()).toEqual({
      deleted: true,
      deletedRules: 0,
    });
  });

  it('reports how many rules name a category', async () => {
    const pets = await createCategory('Pets');
    await createRule({ pattern: 'ZOO', categoryId: pets });
    await createRule({ pattern: 'VET', categoryId: pets });
    const listed = await call('GET', '/api/categories?kind=expense');
    expect(
      listed.json().categories.find((c: { id: number }) => c.id === pets),
    ).toMatchObject({ ruleCount: 2 });
  });

  it('creates rules last by default and first on request', async () => {
    const groceries = 1;
    const first = await createRule({
      pattern: ' REWE, EDEKA ',
      categoryId: groceries,
    });
    const second = await createRule({ pattern: 'LIDL', categoryId: groceries });
    const third = await createRule({
      pattern: 'ALDI',
      categoryId: groceries,
      placement: 'first',
    });
    expect(await ruleIds()).toEqual([third, first, second]);
    expect(await rulePositions()).toEqual([1, 2, 3]);
    const listed = (await call('GET', '/api/rules')).json().rules;
    expect(listed[1]).toMatchObject({
      pattern: 'REWE, EDEKA',
      categoryId: groceries,
      envelopeId: null,
      accountId: null,
      categoryArchived: false,
      envelopeArchived: false,
      createdBy: 1,
    });
  });

  it('stores an envelope and an account on a rule and flags archived ones', async () => {
    const envelope = await createEnvelope();
    const accountId = insertAccount();
    const id = await createRule({
      pattern: 'REWE',
      categoryId: 1,
      envelopeId: envelope,
      accountId,
    });
    let rule = (await call('GET', '/api/rules')).json().rules[0];
    expect(rule).toMatchObject({ id, envelopeId: envelope, accountId });
    await call('PATCH', `/api/envelopes/${envelope}`, { archived: true });
    await call('PATCH', '/api/categories/1', { archived: true });
    rule = (await call('GET', '/api/rules')).json().rules[0];
    expect(rule).toMatchObject({
      categoryArchived: true,
      envelopeArchived: true,
    });
  });

  it('refuses a rule with an income, archived or unknown category', async () => {
    const salary = (await call('GET', '/api/categories?kind=income'))
      .json()
      .categories.find((c: { name: string }) => c.name === 'Salary').id;
    const income = await call('POST', '/api/rules', {
      pattern: 'ACME',
      categoryId: salary,
    });
    expect(income.statusCode).toBe(400);
    expect(income.json().error.fields.categoryId).toBeTruthy();

    await call('PATCH', '/api/categories/1', { archived: true });
    for (const categoryId of [1, 9999]) {
      const response = await call('POST', '/api/rules', {
        pattern: 'REWE',
        categoryId,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(await ruleIds()).toEqual([]);
  });

  it('refuses a rule with a bad pattern, envelope or account', async () => {
    const archivedEnvelope = await createEnvelope('Old');
    await call('PATCH', `/api/envelopes/${archivedEnvelope}`, {
      archived: true,
    });
    for (const body of [
      { pattern: ' , ', categoryId: 2 },
      { pattern: '', categoryId: 2 },
      { pattern: 'X'.repeat(201), categoryId: 2 },
      { pattern: 'REWE', categoryId: 2, envelopeId: 9999 },
      { pattern: 'REWE', categoryId: 2, envelopeId: archivedEnvelope },
      { pattern: 'REWE', categoryId: 2, accountId: 9999 },
      { pattern: 'REWE', categoryId: 2, placement: 'middle' },
      { pattern: 'REWE', categoryId: 2, extra: 1 },
    ]) {
      const response = await call('POST', '/api/rules', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().error.code).toBe('validation');
    }
    expect(await ruleIds()).toEqual([]);
  });

  it('edits a rule without moving it, and checks only what changes', async () => {
    const other = await createRule({ pattern: 'LIDL', categoryId: 1 });
    const id = await createRule({ pattern: 'REWE', categoryId: 2 });
    const blair = await signIn(2);
    const response = await call(
      'PATCH',
      `/api/rules/${id}`,
      { pattern: 'REWE, EDEKA', categoryId: 3, accountId: insertAccount() },
      blair,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().rule).toMatchObject({
      id,
      position: 2,
      pattern: 'REWE, EDEKA',
      categoryId: 3,
      createdBy: 1,
      updatedBy: 2,
    });
    expect(await ruleIds()).toEqual([other, id]);

    // Category 3 is archived later; editing the pattern still works, and
    // naming it again unchanged is not a change.
    await call('PATCH', '/api/categories/3', { archived: true });
    const kept = await call('PATCH', `/api/rules/${id}`, {
      pattern: 'EDEKA',
      categoryId: 3,
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().rule.categoryArchived).toBe(true);
    const moved = await call('PATCH', `/api/rules/${id}`, { categoryId: 4 });
    expect(moved.statusCode).toBe(200);

    const income = await call('PATCH', `/api/rules/${id}`, { categoryId: 15 });
    expect(income.statusCode).toBe(400);
    expect(income.json().error.fields.categoryId).toBeTruthy();
    const cleared = await call('PATCH', `/api/rules/${id}`, {
      accountId: null,
      envelopeId: null,
    });
    expect(cleared.json().rule).toMatchObject({
      accountId: null,
      envelopeId: null,
    });
    for (const payload of [{}, { pattern: ' , ' }]) {
      expect(
        (await call('PATCH', `/api/rules/${id}`, payload)).statusCode,
      ).toBe(400);
    }
    expect(
      (await call('PATCH', '/api/rules/9999', { pattern: 'X' })).statusCode,
    ).toBe(404);
  });

  it('reorders rules by the full list and rewrites positions without gaps', async () => {
    const a = await createRule({ pattern: 'A', categoryId: 1 });
    const b = await createRule({ pattern: 'B', categoryId: 1 });
    const c = await createRule({ pattern: 'C', categoryId: 1 });
    const d = await createRule({ pattern: 'D', categoryId: 1 });

    const response = await call('PUT', '/api/rules/order', {
      ids: [d, a, c, b],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response
        .json()
        .rules.map((r: { id: number; position: number }) => [r.id, r.position]),
    ).toEqual([
      [d, 1],
      [a, 2],
      [c, 3],
      [b, 4],
    ]);
    expect(await ruleIds()).toEqual([d, a, c, b]);
  });

  it('refuses a reorder that is not the full list', async () => {
    const a = await createRule({ pattern: 'A', categoryId: 1 });
    const b = await createRule({ pattern: 'B', categoryId: 1 });
    for (const ids of [[a], [a, b, 9999], [a, 9999]]) {
      const response = await call('PUT', '/api/rules/order', { ids });
      expect(response.statusCode, JSON.stringify(ids)).toBe(409);
      expect(response.json().error.code).toBe('conflict');
    }
    const twice = await call('PUT', '/api/rules/order', { ids: [a, a] });
    expect(twice.statusCode).toBe(400);
    expect(await ruleIds()).toEqual([a, b]);
    expect(await rulePositions()).toEqual([1, 2]);
  });

  it('deletes a rule and closes the gap', async () => {
    const a = await createRule({ pattern: 'A', categoryId: 1 });
    const b = await createRule({ pattern: 'B', categoryId: 1 });
    const c = await createRule({ pattern: 'C', categoryId: 1 });
    const response = await call('DELETE', `/api/rules/${b}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true });
    expect(await ruleIds()).toEqual([a, c]);
    expect(await rulePositions()).toEqual([1, 2]);
    expect((await call('DELETE', `/api/rules/${b}`)).statusCode).toBe(404);
  });

  it('refuses every route without a session', async () => {
    for (const [method, url] of [
      ['GET', '/api/categories'],
      ['POST', '/api/categories'],
      ['PATCH', '/api/categories/1'],
      ['DELETE', '/api/categories/1'],
      ['GET', '/api/rules'],
      ['POST', '/api/rules'],
      ['PATCH', '/api/rules/1'],
      ['PUT', '/api/rules/order'],
      ['DELETE', '/api/rules/1'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: jsonHeaders,
        ...(method === 'GET' ? {} : { payload: {} }),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json().error.code).toBe('unauthenticated');
    }
  });

  /** A device signed in again as a member (1 Alex, 2 Blair). */
  async function signIn(memberId: number): Promise<string> {
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { ...jsonHeaders, 'user-agent': `Device-${memberId}/1.0` },
      payload: { password },
    });
    expect(signedIn.statusCode).toBe(200);
    const cookie = cookieHeader(signedIn);
    const profile = await call(
      'POST',
      '/api/auth/profile',
      { memberId, remember: true },
      cookie,
    );
    expect(profile.statusCode).toBe(200);
    return cookie;
  }
});

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
