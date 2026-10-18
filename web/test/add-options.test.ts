import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sessionLockedCode,
  type AddOptionsResponse,
} from '@budget-buddy/shared';
import {
  createAddOptionsStore,
  refreshAddOptions,
  startAddOptions,
  storeAddOptions,
  storedOptions,
  wipeDeviceData,
  type StoredAddOptions,
} from '../src/offline/addOptions.js';
import { deviceStore, resetDeviceDatabase } from '../src/offline/db.js';
import { outbox, type OutboxItem } from '../src/offline/outbox.js';
import { authState, refreshAuthState } from '../src/stores/auth.js';
import { FakeIndexedDb } from './support/fakeIndexedDb.js';

/**
 * The Add form's options on the phone (spec 2 Design 4; D3): what is kept,
 * that it holds no amount, and when it is deleted with the outbox.
 */

const options: AddOptionsResponse = {
  profileId: 1,
  profiles: [
    { id: 1, name: 'Alena' },
    { id: 2, name: 'Max' },
  ],
  accounts: [
    {
      id: 3,
      name: 'ING Visa',
      ownerMemberId: 1,
      ownerName: 'Alena',
      type: 'bank',
      currency: 'EUR',
      decimals: 2,
      symbol: '€',
    },
  ],
  categories: [
    { id: 4, name: 'Groceries', kind: 'expense', defaultEnvelopeId: 5 },
  ],
  envelopes: [{ id: 5, name: 'Food', currency: 'EUR', defaultCategoryId: 4 }],
  rules: [],
  merchants: [{ merchant: 'REWE', key: 'rewe' }],
  commonCurrency: 'EUR',
  timeZone: 'Europe/Berlin',
};

const waiting: OutboxItem = {
  clientId: 'c1',
  body: {
    clientId: 'c1',
    enteredAt: 1,
    kind: 'expense',
    date: '2026-10-18',
    accountId: 3,
    amount: '1250',
  },
  profileId: 1,
  profileName: 'Alena',
  enteredAt: 1,
  names: {
    account: 'ING Visa',
    currency: 'EUR',
    toAccount: null,
    toCurrency: null,
    category: null,
    envelope: null,
    member: 'Alena',
  },
  state: 'waiting',
  error: null,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('the stored options', () => {
  it('keep the profile they belong to and no amount of any kind', async () => {
    const fake = new FakeIndexedDb();
    const store = createAddOptionsStore(
      deviceStore<StoredAddOptions>('addOptions', () => fake as never),
      () => 42,
    );
    // A server that sent more than it should: the extra fields stay out.
    await store.save({
      ...options,
      balance: '100000',
      accounts: [{ ...options.accounts[0]!, balance: '5' }],
    } as unknown as AddOptionsResponse);

    const [record] = fake.records('budget-buddy', 'addOptions') as [
      StoredAddOptions,
    ];
    expect(record).toMatchObject({
      key: 'current',
      profileId: 1,
      storedAt: 42,
    });
    expect(JSON.stringify(record)).not.toMatch(/amount|balance|total/iu);
    expect(await store.load()).toEqual(options);
    resetDeviceDatabase();
  });

  it('read as none when the record is missing or damaged', async () => {
    const fake = new FakeIndexedDb();
    const raw = deviceStore<StoredAddOptions>(
      'addOptions',
      () => fake as never,
    );
    const store = createAddOptionsStore(raw);
    expect(await store.load()).toBeNull();
    await raw.put({ key: 'current', options: { nope: 1 } } as never);
    expect(await store.load()).toBeNull();
    resetDeviceDatabase();
  });
});

describe('deleting what the phone keeps', () => {
  let fake: FakeIndexedDb;

  beforeEach(async () => {
    fake = new FakeIndexedDb();
    vi.stubGlobal('indexedDB', fake);
    resetDeviceDatabase();
    startAddOptions();
    await storeAddOptions(options);
    await outbox.add(waiting);
    expect(fake.records('budget-buddy', 'addOptions')).toHaveLength(1);
    expect(fake.records('budget-buddy', 'outbox')).toHaveLength(1);
  });

  afterEach(async () => {
    await wipeDeviceData();
    vi.unstubAllGlobals();
    resetDeviceDatabase();
  });

  const gone = () => {
    expect(fake.records('budget-buddy', 'addOptions')).toHaveLength(0);
    expect(fake.records('budget-buddy', 'outbox')).toHaveLength(0);
    expect(storedOptions.value).toBeNull();
    expect(outbox.items.value).toHaveLength(0);
  };
  const kept = () => {
    expect(fake.records('budget-buddy', 'addOptions')).toHaveLength(1);
    expect(fake.records('budget-buddy', 'outbox')).toHaveLength(1);
    expect(storedOptions.value).toEqual(options);
  };

  it('wipes the options and the outbox on a sign-out', async () => {
    await wipeDeviceData();
    gone();
  });

  it('wipes them on a 401 unauthenticated', async () => {
    vi.stubGlobal('fetch', async () =>
      json(401, { error: { code: 'unauthenticated', message: 'No.' } }),
    );
    await refreshAuthState();
    await vi.waitFor(gone);
  });

  it('keeps them on a session_locked answer', async () => {
    vi.stubGlobal('fetch', async () =>
      json(401, { error: { code: sessionLockedCode, message: 'Locked.' } }),
    );
    await refreshAuthState();
    await new Promise((resolve) => setTimeout(resolve, 20));
    kept();
  });

  it('refresh when the signed-in profile changes', async () => {
    const asMax = { ...options, profileId: 2 };
    const fetch = vi.fn(async () => json(200, asMax));
    vi.stubGlobal('fetch', fetch);
    const as = (id: number) =>
      ({ member: { id, name: 'X' } }) as unknown as typeof authState.value;
    authState.value = as(1);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    authState.value = as(2);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(storedOptions.value).toEqual(asMax));
    // A sign-out asks for nothing.
    authState.value = null;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes from the server and keeps the old ones on a failure', async () => {
    const next = { ...options, merchants: [] };
    vi.stubGlobal('fetch', async () => json(200, next));
    expect(await refreshAddOptions()).toEqual(next);
    expect(storedOptions.value).toEqual(next);

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    expect(await refreshAddOptions()).toBeNull();
    expect(storedOptions.value).toEqual(next);
    vi.stubGlobal('fetch', async () => json(500, {}));
    expect(await refreshAddOptions()).toBeNull();
    expect(fake.records('budget-buddy', 'addOptions')).toHaveLength(1);
  });
});
