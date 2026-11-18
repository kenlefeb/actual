// Fork-only (sc-5219, openspec/changes/native-durable-writes D1, D2, D12).
// Runs the INSTALLED absurd-sql backend, never a copy, on fake-indexeddb, so
// this is the tripwire for the yarn patch: a patch that stops applying fails
// here on behaviour. In fallback mode (no SharedArrayBuffer, as in the iPhone
// and Mac shells) a write must settle on the transaction's complete, abort or
// error, in flush order, with the values of its own flush.
import 'fake-indexeddb/auto';
import IndexedDBBackend from 'absurd-sql/dist/indexeddb-backend';

const BLOCK = 4096;

type Ops = {
  open(): void;
  lock(type: number): boolean;
  unlock(type: number): boolean;
  writeBlocks(writes: { pos: number; data: ArrayBuffer }[], size: number): void;
  readIfFallback(): Promise<unknown>;
  whenPersisted(): Promise<void>;
  storageState(): {
    failed: unknown;
    lastStoredFlushAt: number | null;
    quota: boolean;
  };
  persistance: { getDb(): Promise<IDBDatabase> };
};

let counter = 0;
// A fallback-mode file, as the shells get it: SharedArrayBuffer hidden while
// the backend picks its mode
function fallbackFile(onFailure = vi.fn()) {
  const saved = globalThis.SharedArrayBuffer;
  // The shells have none
  (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer = undefined;
  try {
    const backend = new IndexedDBBackend(onFailure);
    const file = backend.createFile(`/blocked/test-${++counter}.sqlite`);
    const ops = (file as unknown as { ops: Ops }).ops;
    ops.open();
    return { ops, onFailure, dbName: `-blocked-test-${counter}.sqlite` };
  } finally {
    globalThis.SharedArrayBuffer = saved;
  }
}

const block = (byte: number) => new Uint8Array(BLOCK).fill(byte).buffer;

async function stored(dbName: string, key: number) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 2);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const value = await new Promise<ArrayBuffer | undefined>(
    (resolve, reject) => {
      const req = db
        .transaction(['data'], 'readonly')
        .objectStore('data')
        .get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    },
  );
  db.close();
  return value ? new Uint8Array(value)[0] : undefined;
}

// Makes the next readwrite transaction fail: an abort with `error`, after
// its puts, as a quota failure or an aborted commit would
async function failNextWrite(ops: Ops, error: DOMException | null) {
  const db = await ops.persistance.getDb();
  const transaction = db.transaction.bind(db);
  db.transaction = ((stores: string[], mode: IDBTransactionMode) => {
    const trans = transaction(stores, mode);
    if (mode === 'readwrite') {
      db.transaction = transaction;
      Object.defineProperty(trans, 'error', { value: error });
      const store = trans.objectStore('data');
      const put = store.put.bind(store);
      store.put = ((value: unknown, key: IDBValidKey) => {
        const req = put(value, key);
        queueMicrotask(() => trans.abort());
        return req;
      }) as never;
    }
    return trans;
  }) as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('absurd-sql fallback writes (patched)', () => {
  it('settle on complete, and whenPersisted waits for them', async () => {
    const { ops, dbName } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(7) }], BLOCK);
    await ops.whenPersisted();
    expect(await stored(dbName, 0)).toBe(7);
    expect(ops.storageState().failed).toBeNull();
  });

  it('keep their order, each with the values of its own flush', async () => {
    const { ops, dbName } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    ops.writeBlocks([{ pos: BLOCK, data: block(2) }], BLOCK);
    ops.writeBlocks([{ pos: 0, data: block(3) }], BLOCK);
    await ops.whenPersisted();
    expect(await stored(dbName, 0)).toBe(3);
    expect(await stored(dbName, 1)).toBe(2);
  });

  it('record the flush time of the last write that stored, not its completion time', async () => {
    const { ops } = fallbackFile();
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    now = 5000;
    await ops.whenPersisted();
    expect(ops.storageState().lastStoredFlushAt).toBe(1000);
  });

  it('reject on abort, latch, stop writing and report the failure', async () => {
    const { ops, onFailure, dbName } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await ops.whenPersisted();
    await failNextWrite(ops, null);
    ops.writeBlocks([{ pos: 0, data: block(2) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toBeTruthy();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(ops.storageState().failed).toBeTruthy();
    expect(ops.storageState().quota).toBe(false);
    // Nothing more is written: IndexedDB stays at the last good commit
    ops.writeBlocks([{ pos: 0, data: block(3) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toBeTruthy();
    expect(await stored(dbName, 0)).toBe(1);
  });

  it('mark a quota failure', async () => {
    const { ops } = fallbackFile();
    await failNextWrite(
      ops,
      new DOMException('The quota has been exceeded.', 'QuotaExceededError'),
    );
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(ops.storageState()).toMatchObject({
      quota: true,
      lastStoredFlushAt: null,
    });
  });

  it('latch when the locked safety check fails', async () => {
    const { ops, onFailure } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await ops.whenPersisted();
    // Locked, while another connection changes the header on disk
    ops.lock(4);
    const db = await ops.persistance.getDb();
    await new Promise<void>((resolve, reject) => {
      const trans = db.transaction(['data'], 'readwrite');
      trans.objectStore('data').put(block(5), 0);
      trans.oncomplete = () => resolve();
      trans.onerror = () => reject(trans.error);
    });
    ops.writeBlocks([{ pos: 0, data: block(9) }], BLOCK);
    ops.unlock(1);
    await expect(ops.whenPersisted()).rejects.toThrow(/unable to write/);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});

describe('absurd-sql SharedArrayBuffer writes', () => {
  it('are durable when they return, so whenPersisted resolves at once', async () => {
    const backend = new IndexedDBBackend(vi.fn());
    const file = backend.createFile(`/blocked/sab-${++counter}.sqlite`);
    const ops = (file as unknown as { ops: Ops }).ops;
    await expect(ops.whenPersisted()).resolves.toBeUndefined();
    expect(ops.storageState()).toEqual({
      failed: null,
      lastStoredFlushAt: null,
      quota: false,
    });
  });
});
