import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackOutbox } from '../src/offline/feedbackOutbox.js';
import { resetDeviceDatabase } from '../src/offline/db.js';
import { outbox, type OutboxItem } from '../src/offline/outbox.js';
import { sendBeforeSignOut, signOutDevice } from '../src/offline/signOut.js';
import { FakeIndexedDb } from './support/fakeIndexedDb.js';

/** Sign-out with waiting feedback (spec 8, O8): sent first, then deleted. */

const tx = (id: string): OutboxItem => ({
  clientId: id,
  body: {
    clientId: id,
    enteredAt: 1,
    kind: 'expense',
    date: '2026-10-18',
    accountId: 3,
    amount: '1250',
    merchant: 'REWE',
  },
  profileId: 1,
  profileName: 'Alena',
  enteredAt: 1,
  names: {
    account: 'ING Visa',
    currency: 'EUR',
    toAccount: null,
    toCurrency: null,
    category: 'Groceries',
    envelope: null,
    member: 'Alena',
  },
  state: 'waiting',
  error: null,
});

const report = (n: number) => ({
  clientId: `00000000-0000-4000-8000-00000000000${n}`,
  kind: 'idea' as const,
  text: 'A made-up idea',
  writtenAt: `2026-11-0${n}T10:00:00Z`,
  device: {
    type: 'other' as const,
    os: null,
    display: 'browser' as const,
    fromScreen: null,
    userAgent: 'TestAgent/1.0',
  },
  screenshot: null,
});

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('sign-out and waiting feedback', () => {
  let fake: FakeIndexedDb;
  let urls: string[];

  function server(routes: Record<string, number>) {
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return json(routes[url] ?? 200);
    });
  }

  beforeEach(async () => {
    fake = new FakeIndexedDb();
    urls = [];
    vi.stubGlobal('indexedDB', fake);
    vi.stubGlobal('navigator', { onLine: true });
    resetDeviceDatabase();
    server({ '/api/feedback': 500, '/api/transactions': 500 });
    expect(await feedbackOutbox.send(report(1))).toBe('saved');
    await outbox.add(tx('t1'));
    urls = [];
  });

  afterEach(async () => {
    await outbox.clear();
    await feedbackOutbox.clear();
    vi.unstubAllGlobals();
    resetDeviceDatabase();
  });

  it('sends the waiting feedback and counts only transactions', async () => {
    server({ '/api/feedback': 201, '/api/transactions': 500 });
    const left = await sendBeforeSignOut();
    expect(urls).toContain('/api/feedback');
    expect(fake.records('budget-buddy', 'feedback')).toHaveLength(0);
    expect(left).toBe(1);
  });

  it('counts only transactions when feedback is still unsent', async () => {
    server({ '/api/feedback': 500, '/api/transactions': 201 });
    expect(await sendBeforeSignOut()).toBe(0);
    expect(fake.records('budget-buddy', 'feedback')).toHaveLength(1);
  });

  it('deletes unsent feedback and transactions on sign-out', async () => {
    server({ '/api/feedback': 500, '/api/transactions': 500 });
    await sendBeforeSignOut();
    expect(fake.records('budget-buddy', 'feedback')).toHaveLength(1);
    server({ '/api/auth/sign-out': 200 });
    await signOutDevice();
    expect(fake.records('budget-buddy', 'feedback')).toHaveLength(0);
    expect(fake.records('budget-buddy', 'outbox')).toHaveLength(0);
    expect(feedbackOutbox.waiting.value).toBe(0);
  });

  it('keeps feedback when the server refuses the sign-out', async () => {
    server({ '/api/auth/sign-out': 500 });
    await expect(signOutDevice()).rejects.toThrow();
    expect(fake.records('budget-buddy', 'feedback')).toHaveLength(1);
  });
});
