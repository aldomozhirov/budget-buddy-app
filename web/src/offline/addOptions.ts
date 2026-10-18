import { shallowRef, watch } from 'vue';
import {
  addOptionsResponseSchema,
  type AddOptionsResponse,
} from '@budget-buddy/shared';
import { authState, onSessionEnded } from '../stores/auth.js';
import { deviceStore, type RecordStore } from './db.js';
import { outbox } from './outbox.js';

/**
 * The Add form's options on the phone (spec 2, Design 4; D3, IOS-6): the
 * names the form and the limited Home need offline, kept in IndexedDB with
 * the profile they belong to. The server's answer has no amount, balance or
 * total, and parsing it again here keeps anything else out of the record.
 */

/** The one record of the `addOptions` store. */
export interface StoredAddOptions {
  key: 'current';
  /** The profile the options were ordered for. */
  profileId: number;
  /** When they were stored, UTC epoch milliseconds. */
  storedAt: number;
  options: AddOptionsResponse;
}

/** The options as stored on this phone; null when there are none. */
export const storedOptions = shallowRef<AddOptionsResponse | null>(null);

/** The options of one page, over a store that outlives it. */
export interface AddOptionsStore {
  /** Reads the stored options; null when none are kept or storage fails. */
  load(): Promise<AddOptionsResponse | null>;
  /** Replaces the stored options with the server's latest answer. */
  save(options: AddOptionsResponse): Promise<void>;
  /** Deletes the stored options. */
  clear(): Promise<void>;
}

/** Builds the options store over a record store; tests pass a fake one. */
export function createAddOptionsStore(
  store: RecordStore<StoredAddOptions>,
  now: () => number = Date.now,
): AddOptionsStore {
  return {
    async load() {
      const record = await store.get('current').catch(() => undefined);
      const parsed = addOptionsResponseSchema.safeParse(record?.options);
      return parsed.success ? parsed.data : null;
    },
    async save(options) {
      // Parsing drops any field the schema does not name.
      const clean = addOptionsResponseSchema.parse(options);
      await store.put({
        key: 'current',
        profileId: clean.profileId,
        storedAt: now(),
        options: clean,
      });
    },
    clear: () => store.clear(),
  };
}

const device = createAddOptionsStore(
  deviceStore<StoredAddOptions>('addOptions'),
);

let ready: Promise<void> | null = null;
let wipes = 0;

/**
 * Resolves once the stored options are read into `storedOptions`, which the
 * route guards and Home wait for before choosing between sign-in and the
 * limited Home.
 */
export function storedOptionsReady(): Promise<void> {
  const wipesAtStart = wipes;
  ready ??= device
    .load()
    .catch(() => null)
    .then((options) => {
      // A save made meanwhile is newer than the read, and a wipe meanwhile
      // means the read is of what was deleted.
      if (wipesAtStart === wipes) storedOptions.value ??= options;
    });
  return ready;
}

/** Keeps the latest options on the phone, and for the page at once. */
export async function storeAddOptions(
  options: AddOptionsResponse,
): Promise<void> {
  storedOptions.value = options;
  await device.save(options).catch(() => undefined);
}

/**
 * Asks the server for the options and stores them. Called whenever Home or
 * the Add form loads online; any failure leaves what is stored.
 * @returns The options, or null when they could not be had.
 */
export async function refreshAddOptions(): Promise<AddOptionsResponse | null> {
  try {
    const response = await fetch('/api/add-options');
    if (!response.ok) return null;
    const options = addOptionsResponseSchema.parse(await response.json());
    await storeAddOptions(options);
    return options;
  } catch {
    return null;
  }
}

/**
 * Deletes what the phone keeps for a signed-in family: the stored options
 * and the outbox (D3). Sign-out and an ended session both do it.
 */
export async function wipeDeviceData(): Promise<void> {
  wipes += 1;
  storedOptions.value = null;
  ready = Promise.resolve();
  await Promise.all([
    device.clear().catch(() => undefined),
    outbox.clear().catch(() => undefined),
  ]);
}

let started = false;

/**
 * Loads the stored options, wipes the phone when a session ends, and
 * refreshes the options when the signed-in profile changes, since their
 * order and the payer on the offline form belong to the profile.
 */
export function startAddOptions(): void {
  if (started) return;
  started = true;
  void storedOptionsReady();
  onSessionEnded(() => void wipeDeviceData());
  watch(
    () => authState.value?.member?.id ?? null,
    (id, previous) => {
      if (id !== null && id !== previous) void refreshAddOptions();
    },
  );
}
