/**
 * A small in-memory IndexedDB for unit tests: the calls `web/src/offline/
 * db.ts` makes, with asynchronous events and structured-clone copies like
 * the real one. One instance is one browser profile; a new connection to it
 * sees what an earlier one wrote, as after a reload.
 */

type Handler = (() => void) | null;

class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

interface StoreData {
  keyPath: string;
  records: Map<string, unknown>;
}

interface DatabaseData {
  version: number;
  stores: Map<string, StoreData>;
}

const later = (task: () => void) => setTimeout(task, 0);

class FakeTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: Error | null = null;
  private pending = 0;

  constructor(private readonly data: DatabaseData) {}

  objectStore(name: string) {
    const store = this.data.stores.get(name);
    if (!store) throw new Error(`No store ${name}.`);
    const run = <T>(action: () => T) => {
      const request = new FakeRequest<T>();
      this.pending += 1;
      later(() => {
        request.result = action();
        request.onsuccess?.();
        this.pending -= 1;
        if (this.pending === 0) later(() => this.oncomplete?.());
      });
      return request;
    };
    return {
      getAll: () =>
        run(() =>
          [...store.records.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([, value]) => structuredClone(value)),
        ),
      get: (key: string) =>
        run(() => {
          const value = store.records.get(key);
          return value === undefined ? undefined : structuredClone(value);
        }),
      put: (value: Record<string, unknown>) => {
        // Cloned now, as IndexedDB does: a Vue proxy would throw here.
        const copy = structuredClone(value);
        return run(() => {
          const key = String(copy[store.keyPath]);
          store.records.set(key, copy);
          return key;
        });
      },
      delete: (key: string) => run(() => void store.records.delete(key)),
      clear: () => run(() => store.records.clear()),
    };
  }
}

class FakeConnection {
  onversionchange: Handler = null;

  constructor(private readonly data: DatabaseData) {}

  get objectStoreNames() {
    return { contains: (name: string) => this.data.stores.has(name) };
  }

  createObjectStore(name: string, options: { keyPath: string }) {
    this.data.stores.set(name, {
      keyPath: options.keyPath,
      records: new Map(),
    });
  }

  transaction(name: string) {
    if (!this.data.stores.has(name)) throw new Error(`No store ${name}.`);
    return new FakeTransaction(this.data);
  }

  close() {}
}

/** A fake `IDBFactory` (cast it where one is expected). */
export class FakeIndexedDb {
  private readonly databases = new Map<string, DatabaseData>();
  /** How many times a database was opened. */
  opens = 0;

  open(name: string, version: number) {
    const request = new FakeRequest<FakeConnection>();
    this.opens += 1;
    later(() => {
      let data = this.databases.get(name);
      if (!data) {
        data = { version: 0, stores: new Map() };
        this.databases.set(name, data);
      }
      request.result = new FakeConnection(data);
      if (data.version < version) {
        data.version = version;
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    });
    return request;
  }

  /** The records of a store, as stored. */
  records(database: string, store: string): unknown[] {
    return [
      ...(this.databases.get(database)?.stores.get(store)?.records.values() ??
        []),
    ];
  }
}
