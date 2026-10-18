/**
 * The app's one IndexedDB database on the device (spec 2, Design 4 and D3):
 * a small promise wrapper over the parts of IndexedDB the app uses, so no
 * `idb` package is needed. Each store keeps whole records by a key path.
 */

/** Name of the device database. */
export const DB_NAME = 'budget-buddy';

/** Schema version; a new store raises it and is created on upgrade. */
export const DB_VERSION = 2;

/** The object stores and their key paths. */
export const STORES = { outbox: 'clientId', addOptions: 'key' } as const;

/** Name of an object store of the device database. */
export type StoreName = keyof typeof STORES;

/** A key-value store of whole records, as the outbox and options need it. */
export interface RecordStore<T> {
  /** Every record, in key order. */
  getAll(): Promise<T[]>;
  /** One record, or undefined when there is none with this key. */
  get(key: string): Promise<T | undefined>;
  /** Adds or replaces a record by its key. */
  put(value: T): Promise<void>;
  /** Removes a record; removing a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** Removes every record. */
  clear(): Promise<void>;
}

let opening: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IDB failed.'));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath });
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab with a newer version asks this one to let go.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open the device store.'));
    request.onblocked = () =>
      reject(new Error('The device store is busy in another tab.'));
  });
}

/**
 * A store of the device database. The database opens on first use and stays
 * open; a failed open is tried again on the next call.
 * @param factory IndexedDB itself, or a fake one in tests.
 * @throws when IndexedDB is not available, on the first operation.
 */
export function deviceStore<T>(
  name: StoreName,
  factory: () => IDBFactory = () => indexedDB,
): RecordStore<T> {
  function database(): Promise<IDBDatabase> {
    opening ??= openDatabase(factory()).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  }

  async function run<R>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> {
    const db = await database();
    const transaction = db.transaction(name, mode);
    const result = requestResult(action(transaction.objectStore(name)));
    // A write counts only once its transaction has committed.
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IDB write failed.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IDB write aborted.'));
    });
    const [value] = await Promise.all([result, done]);
    return value;
  }

  return {
    getAll: () => run('readonly', (store) => store.getAll() as IDBRequest<T[]>),
    get: (key) =>
      run('readonly', (store) => store.get(key) as IDBRequest<T | undefined>),
    put: async (value) => {
      await run('readwrite', (store) => store.put(value));
    },
    delete: async (key) => {
      await run('readwrite', (store) => store.delete(key));
    },
    clear: async () => {
      await run('readwrite', (store) => store.clear());
    },
  };
}

/** Forgets the open database, so tests can start from a new fake one. */
export function resetDeviceDatabase(): void {
  opening = null;
}
