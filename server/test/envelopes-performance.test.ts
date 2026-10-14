import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  listEnvelopeStates,
  savePlan,
  topUpEnvelopes,
} from '../src/domain/envelopes.js';
import {
  createFamilyDatabase,
  type FamilyDatabase,
} from './summary-fixture.js';

const envelopeCount = 5;
const transactionCount = 100_000;
const startingMonth = '2016-10';
const currentMonth = '2026-10';
const budgetMs = 300;

let family: FamilyDatabase;

/**
 * Ten years of monthly records for five envelopes: 600 top-ups, 600
 * adjustments and 100,000 expenses spread over 3,650 days.
 */
beforeEach(async () => {
  family = await createFamilyDatabase();
  const { database } = family;
  const account = family.account({
    name: 'Joint',
    owner: null,
    type: 'bank',
    currency: 'EUR',
  });
  const insertEnvelope = database.prepare(
    `INSERT INTO envelope (name, currency, starting_balance, starting_month,
      topup_from_month, position, created_by, created_at, updated_by,
      updated_at)
    VALUES (?, 'EUR', 10000, ?, '2016-11', ?, 1, 1, 1, 1)`,
  );
  const insertTxn = database.prepare(
    `INSERT INTO txn (kind, date, account_id, amount, member_id, created_by,
      created_at, updated_by, updated_at)
    VALUES ('expense', ?, ?, ?, 1, 1, 1, 1, 1)`,
  );
  const insertPart = database.prepare(
    `INSERT INTO txn_part (txn_id, position, amount, envelope_id,
      envelope_amount) VALUES (?, 1, ?, ?, ?)`,
  );
  const insertAdjustment = database.prepare(
    `INSERT INTO envelope_adjustment (envelope_id, date, amount, created_by,
      created_at) VALUES (?, ?, ?, 1, 1)`,
  );
  database.transaction(() => {
    const envelopes: number[] = [];
    for (let index = 0; index < envelopeCount; index += 1) {
      const id = Number(
        insertEnvelope.run(`Envelope ${index}`, startingMonth, index + 1)
          .lastInsertRowid,
      );
      savePlan(database, {
        envelopeId: id,
        fromMonth: startingMonth,
        monthlyAmount: 50_000n,
        mode: index % 2 === 0 ? 'carry_over' : 'reset',
        createdBy: 1,
        now: 1,
      });
      envelopes.push(id);
    }
    topUpEnvelopes(database, currentMonth, 1);
    const first = Date.parse('2016-10-01T00:00:00Z');
    const day = 86_400_000;
    for (let index = 0; index < transactionCount; index += 1) {
      const date = new Date(first + (index % 3650) * day)
        .toISOString()
        .slice(0, 10);
      const amount = BigInt(500 + (index % 9000));
      const envelope = envelopes[index % envelopeCount] ?? 1;
      const txnId = insertTxn.run(date, account, amount).lastInsertRowid;
      // One part in a thousand waits for a rate.
      insertPart.run(
        txnId,
        amount,
        envelope,
        index % 1000 === 0 ? null : amount,
      );
    }
    for (const envelope of envelopes) {
      for (let month = 0; month < 120; month += 1) {
        const date = new Date(first + month * 30 * day)
          .toISOString()
          .slice(0, 10);
        insertAdjustment.run(envelope, date, BigInt(month % 2 ? 1000 : -500));
      }
    }
  })();
});

afterEach(async () => {
  await family.close();
});

it('computes every envelope’s current state in under 300 ms', () => {
  const started = performance.now();
  const states = listEnvelopeStates(family.database, currentMonth);
  const elapsed = performance.now() - started;

  expect(states).toHaveLength(envelopeCount);
  for (const state of states) {
    expect(state.months).toHaveLength(121);
    expect(state.current?.month).toBe(currentMonth);
  }
  console.log(`Envelope states: ${elapsed.toFixed(1)} ms`);
  expect(elapsed, `took ${elapsed.toFixed(1)} ms`).toBeLessThan(budgetMs);
});
