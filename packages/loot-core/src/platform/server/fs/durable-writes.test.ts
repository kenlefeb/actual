// Fork-only (sc-5219, openspec/changes/native-durable-writes D1, D2, D12).
// Runs the INSTALLED absurd-sql backend, never a copy, on fake-indexeddb, so
// this is the tripwire for the yarn patch: a patch that stops applying fails
// here on behaviour. In fallback mode (no SharedArrayBuffer, as in the iPhone
// and Mac shells) a write must settle on the transaction's complete, abort or
// error, in flush order, with the values of its own flush. Until the native
// bridge turns the guard on, a failure behaves exactly as in stock absurd-sql.
import 'fake-indexeddb/auto';
import IndexedDBBackend from 'absurd-sql/dist/indexeddb-backend';

import {
  filesStorageState,
  filesWhenPersisted,
  isOpenFile,
} from './storage-state';
import type { StorageFile } from './storage-state';

const BLOCK = 4096;

type Ops = {
  open(): void;
  lock(type: number): boolean;
  unlock(type: number): boolean;
  writeBlocks(writes: { pos: number; data: ArrayBuffer }[], size: number): void;
  writeMeta(meta: { size: number }): void;
  readBlocks(
    positions: number[],
    size: number,
  ): { pos: number; data: ArrayBuffer }[];
  whenPersisted(): Promise<void>;
  storageState(): {
    failed: unknown;
    lastStoredFlushAt: number | null;
    quota: boolean;
  };
  persistance: {
    _openDb: IDBDatabase | null;
    getDb(): Promise<IDBDatabase>;
    readAll(): Promise<unknown>;
    write(...args: unknown[]): Promise<void>;
  };
};

type TestFile = {
  ops: Ops;
  meta: { size: number; blockSize?: number } | null;
  open(): void;
  close(): void;
  delete(): void;
  readIfFallback(): Promise<void>;
};

let counter = 0;
// Fallback mode, as the shells get it: SharedArrayBuffer hidden while the
// backend picks its mode
function withoutSharedArrayBuffer<T>(run: () => T): T {
  const saved = globalThis.SharedArrayBuffer;
  (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer = undefined;
  try {
    return run();
  } finally {
    globalThis.SharedArrayBuffer = saved;
  }
}

function openFile(backend: IndexedDBBackend, name: string) {
  return withoutSharedArrayBuffer(() => {
    const file = backend.createFile(name) as TestFile;
    file.open();
    return file;
  });
}

// `guard: false` is what every client gets until the native bridge turns it on
function fallbackFile({ guard = true, onFailure = vi.fn() } = {}) {
  const backend = new IndexedDBBackend(onFailure);
  if (guard) backend.enableLatch();
  const name = `/blocked/test-${++counter}.sqlite`;
  const file = openFile(backend, name);
  return {
    backend,
    file,
    name,
    ops: file.ops,
    onFailure,
    dbName: name.replace(/\//g, '-'),
  };
}

// Every byte is `byte`, so SQLite's change counter (bytes 24-40) differs
// between pages; the page size is big-endian at offset 16
function block(byte: number) {
  const page = new Uint8Array(BLOCK).fill(byte);
  page.set([0x10, 0], 16);
  return page.buffer;
}

const firstByte = (file: TestFile) =>
  new Uint8Array(file.ops.readBlocks([0], BLOCK)[0].data)[0];

// A write under SQLite's write lock, so the safety check runs
function lockedWrite(ops: Ops, byte: number) {
  ops.lock(4);
  ops.writeBlocks([{ pos: 0, data: block(byte) }], BLOCK);
  ops.unlock(1);
}

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

// Makes the next write fail on a request: the put hits an existing key
async function failNextPut(ops: Ops) {
  const db = await ops.persistance.getDb();
  const transaction = db.transaction.bind(db);
  db.transaction = ((stores: string[], mode: IDBTransactionMode) => {
    const trans = transaction(stores, mode);
    if (mode === 'readwrite') {
      db.transaction = transaction;
      const store = trans.objectStore('data');
      store.put = store.add.bind(store) as never;
    }
    return trans;
  }) as never;
}

const quotaError = () =>
  new DOMException('The quota has been exceeded.', 'QuotaExceededError');

afterEach(() => {
  vi.restoreAllMocks();
});

// The Architect's ruling on #473/#474: everything new waits for the guard
describe('absurd-sql fallback writes with the guard off', () => {
  it('fail as in stock: unseen, then the safety check refuses the next locked write and alerts once', async () => {
    const { ops, onFailure, dbName } = fallbackFile({ guard: false });
    lockedWrite(ops, 1);
    await ops.whenPersisted();

    await failNextWrite(ops, quotaError());
    lockedWrite(ops, 2);
    await expect(ops.whenPersisted()).resolves.toBeUndefined();
    expect(onFailure).not.toHaveBeenCalled();
    expect(ops.storageState()).toMatchObject({ failed: null, quota: false });

    // Memory's change counter moved on and the stored one did not
    lockedWrite(ops, 3);
    await ops.whenPersisted();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith();
    expect(await stored(dbName, 0)).toBe(1);

    lockedWrite(ops, 4);
    await ops.whenPersisted();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(await stored(dbName, 0)).toBe(1);
  });

  it('do not stop: a later write without the lock is still stored', async () => {
    const { ops, onFailure, dbName } = fallbackFile({ guard: false });
    await failNextWrite(ops, quotaError());
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await ops.whenPersisted();
    ops.writeBlocks([{ pos: BLOCK, data: block(2) }], BLOCK);
    await ops.whenPersisted();
    expect(await stored(dbName, 1)).toBe(2);
    expect(onFailure).not.toHaveBeenCalled();
    expect(ops.storageState().failed).toBeNull();
  });

  it('latch when the guard turns on after one failed, at the cut-off of that failure', async () => {
    const { backend, ops, onFailure, dbName } = fallbackFile({ guard: false });
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await ops.whenPersisted();
    now = 2000;
    await failNextWrite(ops, quotaError());
    ops.writeBlocks([{ pos: 0, data: block(2) }], BLOCK);
    await ops.whenPersisted();
    now = 3000;
    ops.writeBlocks([{ pos: BLOCK, data: block(3) }], BLOCK);
    await ops.whenPersisted();

    backend.enableLatch();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ lastStoredFlushAt: 1000, quota: true }),
      ops,
    );
    await expect(ops.whenPersisted()).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    ops.writeBlocks([{ pos: 0, data: block(4) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toBeTruthy();
    expect(await stored(dbName, 0)).toBe(1);
  });
});

// Writes wait in a chain now, so IndexedDB no longer orders a read behind them
describe('absurd-sql fallback reads', () => {
  function writeOnePage(ops: Ops) {
    ops.writeMeta({ size: BLOCK });
    ops.writeBlocks([{ pos: 0, data: block(7) }], BLOCK);
  }

  it.each([{ guard: true }, { guard: false }])(
    'see every write flushed before them, on the same file (%o)',
    async ({ guard }) => {
      const { file, ops } = fallbackFile({ guard });
      writeOnePage(ops);
      file.close();
      await file.readIfFallback();
      expect(file.meta).toEqual({ size: BLOCK, blockSize: BLOCK });
      expect(firstByte(file)).toBe(7);
    },
  );

  it.each([{ guard: true }, { guard: false }])(
    'see them from a new file of the same name (%o)',
    async ({ guard }) => {
      const { backend, file, ops, name } = fallbackFile({ guard });
      writeOnePage(ops);
      file.close();
      const reopened = openFile(backend, name);
      await reopened.readIfFallback();
      expect(reopened.meta).toEqual({ size: BLOCK, blockSize: BLOCK });
      expect(firstByte(reopened)).toBe(7);
    },
  );

  it('give up after a minute behind a write that never settles, and do not read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { file, ops } = fallbackFile({ guard: false });
      ops.persistance.write = () => new Promise(() => undefined);
      const readAll = vi.spyOn(ops.persistance, 'readAll');
      writeOnePage(ops);
      let settled = false;
      const failure = file.readIfFallback().then(
        () => null,
        (error: Error) => {
          settled = true;
          return error;
        },
      );
      await vi.advanceTimersByTimeAsync(59_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await failure)?.message).toMatch(/timed out/i);
      expect(readAll).not.toHaveBeenCalled();
      expect(file.meta).toEqual({ size: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('may take longer than the deadline once their turn has come', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { file, ops } = fallbackFile({ guard: false });
      vi.spyOn(ops.persistance, 'readAll').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 120_000));
        return new Map();
      });
      const read = file.readIfFallback();
      await vi.advanceTimersByTimeAsync(120_000);
      await expect(read).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('after a reload, find the last write that stored', async () => {
    const { ops, name } = fallbackFile();
    ops.writeMeta({ size: BLOCK });
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await ops.whenPersisted();
    await failNextWrite(ops, quotaError());
    ops.writeBlocks([{ pos: 0, data: block(2) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toBeTruthy();
    const reloaded = openFile(new IndexedDBBackend(vi.fn()), name);
    await reloaded.readIfFallback();
    expect(firstByte(reloaded)).toBe(1);
  });
});

// D8, Security on PR #481: budget B opens while closing A's last write is
// pending, and the app then quits or goes to the background
describe('a lifecycle flush', () => {
  async function isSettled(wait: Promise<void>) {
    let settled = false;
    void wait.then(() => {
      settled = true;
    });
    await new Promise(resolve => setTimeout(resolve));
    return settled;
  }

  it("waits for a closed budget's last write while another budget is open", async () => {
    const { backend, file, ops } = fallbackFile({ guard: false });
    let finish: () => void = () => undefined;
    ops.persistance.write = () =>
      new Promise<void>(resolve => {
        finish = resolve;
      });
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    file.close();
    openFile(backend, `/blocked/test-${++counter}.sqlite`);
    const files = [...backend.files] as StorageFile[];

    // An ordinary wait covers only the open budget
    expect(await isSettled(filesWhenPersisted(files))).toBe(true);
    const flush = filesWhenPersisted(files, { allFiles: true });
    expect(await isSettled(flush)).toBe(false);
    finish();
    await expect(flush).resolves.toBeUndefined();
  });
});

describe('absurd-sql fallback closes and deletes', () => {
  it('close the connection only after the writes before them', async () => {
    const { backend, file, ops, name } = fallbackFile({ guard: false });
    await ops.persistance.getDb();
    ops.writeMeta({ size: BLOCK });
    ops.writeBlocks([{ pos: 0, data: block(7) }], BLOCK);
    file.close();
    await ops.whenPersisted();
    // A close that ran first would leave the write's reopened connection behind
    await vi.waitFor(() => expect(ops.persistance._openDb).toBeNull());
    const reopened = openFile(backend, name);
    await reopened.readIfFallback();
    expect(firstByte(reopened)).toBe(7);
  });

  it('delete the database after a pending write, and it stays gone', async () => {
    const { backend, file, ops, name } = fallbackFile({ guard: false });
    ops.writeMeta({ size: BLOCK });
    ops.writeBlocks([{ pos: 0, data: block(7) }], BLOCK);
    file.close();
    file.delete();
    const reopened = openFile(backend, name);
    await reopened.readIfFallback();
    expect(reopened.meta).toEqual({ size: 0 });
  });
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
    // With the file's ops, so the engine can tell an open budget from a closed one
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ quota: false }),
      ops,
    );
    expect(ops.storageState().failed).toBeTruthy();
    expect(ops.storageState().quota).toBe(false);
    // Nothing more is written: IndexedDB stays at the last good commit
    ops.writeBlocks([{ pos: 0, data: block(3) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toBeTruthy();
    expect(await stored(dbName, 0)).toBe(1);
  });

  it('mark a quota failure', async () => {
    const { ops } = fallbackFile();
    await failNextWrite(ops, quotaError());
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(ops.storageState()).toMatchObject({
      quota: true,
      lastStoredFlushAt: null,
    });
  });

  it('keep the name of an error raised by a request', async () => {
    const { ops } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await ops.whenPersisted();
    await failNextPut(ops);
    ops.writeBlocks([{ pos: 0, data: block(2) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toMatchObject({
      name: 'ConstraintError',
    });
  });

  it('keep a failure visible when the same name gets a new file', async () => {
    const { backend, ops, name } = fallbackFile();
    await failNextWrite(ops, null);
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toBeTruthy();
    openFile(backend, name);
    expect(filesStorageState([...backend.files] as StorageFile[]).failed).toBe(
      true,
    );
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
    // The stock alert, then the latch
    expect(onFailure).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledWith();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ quota: false }),
      ops,
    );
  });
});

// D10: the control run's commit delay exists only behind the build constant
describe('the commit-delay test hook', () => {
  const hooks = globalThis as {
    __FORK_TEST_HOOKS__?: boolean;
    __forkTestCommitDelayMs?: number;
  };

  afterEach(() => {
    vi.useRealTimers();
    delete hooks.__FORK_TEST_HOOKS__;
    delete hooks.__forkTestCommitDelayMs;
  });

  it('delays a commit while the constant is on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hooks.__FORK_TEST_HOOKS__ = true;
    hooks.__forkTestCommitDelayMs = 300;
    const { ops, dbName } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(4) }], BLOCK);
    let settled = false;
    const persisted = ops.whenPersisted().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await persisted;
    expect(await stored(dbName, 0)).toBe(4);
  });

  it('does nothing without the constant', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hooks.__forkTestCommitDelayMs = 300;
    const { ops, dbName } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(6) }], BLOCK);
    await ops.whenPersisted();
    expect(await stored(dbName, 0)).toBe(6);
  });
});

// D10 (sc-5219 guard flip): a test build can make the next IndexedDB write
// fail for real, so the failure path runs end to end on a simulator
describe('the storage-failure test hook', () => {
  const hooks = globalThis as {
    __FORK_TEST_HOOKS__?: boolean;
    __forkTestFailStorage?: 'abort' | 'quota' | null;
  };

  afterEach(() => {
    delete hooks.__FORK_TEST_HOOKS__;
    delete hooks.__forkTestFailStorage;
  });

  it('aborts the next write in IndexedDB once, and it fails as an abort does', async () => {
    hooks.__FORK_TEST_HOOKS__ = true;
    const { ops, onFailure, dbName } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await ops.whenPersisted();
    hooks.__forkTestFailStorage = 'abort';
    ops.writeBlocks([{ pos: 0, data: block(2) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toBeTruthy();
    expect(hooks.__forkTestFailStorage).toBeNull();
    expect(ops.storageState()).toMatchObject({ quota: false });
    expect(ops.storageState().failed).toBeTruthy();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ quota: false }),
      ops,
    );
    // The aborted transaction stored nothing
    expect(await stored(dbName, 0)).toBe(1);
  });

  it('fails the next write as a full device does', async () => {
    hooks.__FORK_TEST_HOOKS__ = true;
    hooks.__forkTestFailStorage = 'quota';
    const { ops } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(1) }], BLOCK);
    await expect(ops.whenPersisted()).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(ops.storageState()).toMatchObject({ quota: true });
  });

  it('does nothing without the constant', async () => {
    hooks.__forkTestFailStorage = 'abort';
    const { ops, dbName } = fallbackFile();
    ops.writeBlocks([{ pos: 0, data: block(7) }], BLOCK);
    await ops.whenPersisted();
    expect(await stored(dbName, 0)).toBe(7);
  });
});

// "Of the open budget": a closed budget's file neither latches nor blocks
describe('the storage state across files', () => {
  const file = (
    openHandles: number,
    state: Partial<ReturnType<Ops['storageState']>>,
    whenPersisted = () => Promise.resolve(),
    filename = '/blocked/open',
  ) => ({
    filename,
    openHandles,
    ops: {
      whenPersisted,
      storageState: () => ({
        failed: null,
        lastStoredFlushAt: null,
        quota: false,
        ...state,
      }),
    },
  });

  it('reports the newest stored flush of the open files', () => {
    expect(
      filesStorageState([
        file(1, { lastStoredFlushAt: 10 }),
        file(1, { lastStoredFlushAt: 20 }),
        file(0, { lastStoredFlushAt: 30 }),
      ]),
    ).toEqual({ failed: false, lastStoredFlushAt: 20, quota: false });
  });

  it("reports an open file's failure with that file's cut-off", () => {
    expect(
      filesStorageState([
        file(1, { lastStoredFlushAt: 20 }),
        file(1, { failed: new Error('x'), lastStoredFlushAt: 10, quota: true }),
      ]),
    ).toEqual({ failed: true, lastStoredFlushAt: 10, quota: true });
  });

  it("ignores a closed file's failure, but still waits for its writes", async () => {
    const failed = new Error('x');
    const closed = file(0, { failed }, () => Promise.reject(failed));
    expect(filesStorageState([closed]).failed).toBe(false);
    await expect(filesWhenPersisted([closed])).resolves.toBeUndefined();
    const open = file(1, { failed }, () => Promise.reject(failed));
    await expect(filesWhenPersisted([open])).rejects.toBe(failed);
  });

  const stuck = () => new Promise<void>(() => undefined);

  // A flush right after closing a budget must cover its last write
  it('waits for every file when none is open', async () => {
    let settled = false;
    void filesWhenPersisted([file(0, {}, stuck, '/blocked/closed')]).then(
      () => {
        settled = true;
      },
    );
    await new Promise(resolve => setTimeout(resolve));
    expect(settled).toBe(false);
  });

  it("does not wait for another budget's stuck write once one is open", async () => {
    await expect(
      filesWhenPersisted([file(0, {}, stuck, '/blocked/closed'), file(1, {})]),
    ).resolves.toBeUndefined();
  });

  it("waits for earlier writes under the open budget's own name", async () => {
    let settled = false;
    void filesWhenPersisted([file(0, {}, stuck), file(1, {})]).then(() => {
      settled = true;
    });
    await new Promise(resolve => setTimeout(resolve));
    expect(settled).toBe(false);
  });
});

// A failure reaches the app one way for the open budget, another for a closed one
describe('telling which file failed', () => {
  const ops = {};

  it('finds the open budget by its ops', () => {
    expect(isOpenFile([{ openHandles: 1, ops }], ops)).toBe(true);
  });

  it('does not count a closed file, or a replacement under the same name', () => {
    expect(isOpenFile([{ openHandles: 0, ops }], ops)).toBe(false);
    expect(isOpenFile([{ openHandles: 1, ops: {} }], ops)).toBe(false);
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
