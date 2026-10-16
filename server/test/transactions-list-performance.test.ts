import { afterEach, beforeEach, expect, it } from 'vitest';
import { insertStarterCategories } from '../src/db/starterCategories.js';
import {
  listTransactions,
  transactionFacets,
} from '../src/modules/transactions/list.js';
import {
  createFamilyDatabase,
  type FamilyDatabase,
} from './summary-fixture.js';

const transactionCount = 100_000;
const dayCount = 3650;
const budgetMs = 300;
const now = Date.parse('2026-10-15T10:00:00.000Z');
const day = 86_400_000;

let family: FamilyDatabase;

/**
 * PRF-1's volume: 40 accounts in three currencies, 3,650 days of rates, and
 * 100,000 transactions over ten years (85% expenses, a few refunds,
 * incomes and transfers), written in one database transaction.
 */
beforeEach(async () => {
  family = await createFamilyDatabase();
  const { database } = family;
  insertStarterCategories(database, 1);
  const accounts: Array<{ id: number; currency: string }> = [];
  for (let index = 0; index < 40; index += 1) {
    const currency = index < 30 ? 'EUR' : index < 38 ? 'USD' : 'GBP';
    accounts.push({
      id: family.account({
        name: `Account ${index}`,
        owner: index % 2 === 0 ? 'Alex' : 'Blair',
        type: 'bank',
        currency,
      }),
      currency,
    });
  }
  const envelope = database.prepare(
    `INSERT INTO envelope (name, currency, starting_balance, starting_month,
      topup_from_month, position, created_by, created_at, updated_by,
      updated_at)
    VALUES (?, 'EUR', 0, '2016-10', '2016-11', ?, 1, 1, 1, 1)`,
  );
  const envelopes = [1, 2, 3].map((position) =>
    Number(envelope.run(`Envelope ${position}`, position).lastInsertRowid),
  );
  const insertTxn = database.prepare(
    `INSERT INTO txn (kind, date, account_id, amount, to_account_id,
      to_amount, member_id, merchant, merchant_key, note, created_by,
      created_at, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1)`,
  );
  const insertPart = database.prepare(
    `INSERT INTO txn_part (txn_id, position, amount, category_id, envelope_id,
      envelope_amount) VALUES (?, 1, ?, ?, ?, ?)`,
  );
  const last = Date.parse('2026-10-15T00:00:00Z');
  database.transaction(() => {
    for (let offset = 0; offset < dayCount; offset += 1) {
      const date = new Date(last - offset * day).toISOString().slice(0, 10);
      family.rate('USD', 'EUR', date, (0.85 + (offset % 40) / 400).toFixed(4));
      family.rate('GBP', 'EUR', date, (1.1 + (offset % 30) / 300).toFixed(4));
    }
    for (let index = 0; index < transactionCount; index += 1) {
      const date = new Date(last - (index % dayCount) * day)
        .toISOString()
        .slice(0, 10);
      const account = accounts[(index * 7) % accounts.length] ?? accounts[0];
      if (!account) throw new Error('No account.');
      const amount = BigInt(150 + ((index * 37) % 20_000));
      const member = 1 + (index % 2);
      const merchant = `Merchant ${index % 200}`;
      const slot = index % 20;
      const withMerchant = slot !== 3;
      if (slot === 0) {
        // A transfer between two EUR accounts.
        const to = accounts[(index * 7 + 2) % 30];
        const from = accounts[(index * 11) % 30];
        if (!to || !from || to.id === from.id) continue;
        insertTxn.run(
          'transfer',
          date,
          from.id,
          amount,
          to.id,
          amount,
          member,
          null,
          null,
          null,
        );
        continue;
      }
      const kind = slot === 1 ? 'income' : 'expense';
      const signed = slot === 2 ? -amount : amount;
      const txn = insertTxn.run(
        kind,
        date,
        account.id,
        signed,
        null,
        null,
        member,
        withMerchant && kind === 'expense' ? merchant : null,
        withMerchant && kind === 'expense' ? merchant.toLowerCase() : null,
        index % 5 === 0 ? `Note ${index % 50}` : null,
      ).lastInsertRowid;
      // A tenth of the parts wait for a category.
      insertPart.run(
        txn,
        signed,
        index % 10 === 4 ? null : 1 + (index % 16),
        kind === 'expense' && index % 3 === 0 ? envelopes[index % 3] : null,
        null,
      );
    }
  })();
});

afterEach(async () => {
  await family.close();
});

/** Runs `work` and fails when it takes the budget or longer. */
function timed<T>(label: string, work: () => T, budget = budgetMs): T {
  const started = performance.now();
  const result = work();
  const elapsed = performance.now() - started;
  console.log(`${label}: ${elapsed.toFixed(1)} ms`);
  expect(elapsed, `${label} took ${elapsed.toFixed(1)} ms`).toBeLessThan(
    budget,
  );
  return result;
}

it('answers the first page, its summary and a facet in under 300 ms each', () => {
  const { database } = family;
  const count = database.prepare('SELECT COUNT(*) AS n FROM txn').get() as {
    n: bigint;
  };
  expect(Number(count.n)).toBeGreaterThan(transactionCount * 0.9);

  const page = timed('First page and summary, all time', () =>
    listTransactions(database, { period: 'all' }, now),
  );
  expect(page.transactions).toHaveLength(50);
  expect(page.summary.count).toBe(Number(count.n));
  expect(page.summary.incomplete).toBe(false);

  const month = timed('First page and summary, this month', () =>
    listTransactions(database, {}, now),
  );
  expect(month.summary.count).toBeGreaterThan(0);

  timed('Category facet, all time', () =>
    transactionFacets(database, 'category', { period: 'all' }, now),
  );
  timed('Account facet, all time', () =>
    transactionFacets(database, 'account', { period: 'all' }, now),
  );
  timed('Next page by cursor', () =>
    listTransactions(
      database,
      { period: 'all', cursor: `2020-01-01:50000` },
      now,
    ),
  );
});

it('searches ten years of transactions within a second', () => {
  const found = timed(
    'Search "merchant 17", all time',
    () =>
      listTransactions(
        family.database,
        { period: 'all', q: 'merchant 17' },
        now,
      ),
    1000,
  );
  expect(found.summary.count).toBeGreaterThan(0);
});
