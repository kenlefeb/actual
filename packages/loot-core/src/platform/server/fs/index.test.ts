import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { patchFetchForSqlJS } from '#mocks/util';
import * as connection from '#platform/server/connection';
import * as idb from '#platform/server/indexeddb';
import * as sqlite from '#platform/server/sqlite';

import {
  _setDocumentDir,
  enableStorageLatch,
  exists,
  init,
  join,
  pathToId,
  readFile,
  storageState,
  whenPersisted,
  writeFile,
} from './index';

vi.mock('#platform/server/connection', () => ({ send: vi.fn() }));

beforeAll(() => {
  const baseURL = `${__dirname}/../../../../../../node_modules/@jlongster/sql.js/dist/`;
  patchFetchForSqlJS(baseURL);
  process.env.PUBLIC_URL = baseURL;
});

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

afterEach(() => {
  sqlite._getModule().reset_filesystem();
});

describe('web filesystem', () => {
  test('basic reads/writes are stored in idb', async () => {
    await idb.openDatabase();
    await sqlite.init();
    await init();

    // Text file
    await writeFile('/documents/foo.txt', 'hello');
    expect(await readFile('/documents/foo.txt')).toBe('hello');

    // Binary file
    const str = 'hello, world';
    const buf = new ArrayBuffer(str.length * 2);
    const view = new Uint16Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
      view[i] = str.charCodeAt(i);
    }

    await writeFile('/documents/foo.bin', buf);
    expect(await readFile('/documents/foo.bin')).toBe('hello, world');

    const db = await idb.openDatabase();
    const { store } = idb.getStore(db, 'files');

    // Make sure they are in idb
    expect(await idb.get(store, '/documents/foo.txt')).toEqual({
      filepath: '/documents/foo.txt',
      contents: 'hello',
    });
    const binResult = await idb.get(store, '/documents/foo.bin');
    expect(binResult.filepath).toBe('/documents/foo.bin');
    expect(Array.from(binResult.contents)).toEqual(
      Array.from(new Uint8Array(buf)),
    );

    // Write a file outside of documents
    await writeFile('/outside.txt', 'some junk');
    expect(await readFile('/outside.txt')).toBe('some junk');
    expect(await idb.get(store, '/outside.txt')).toBe(undefined);

    await idb.closeDatabase();
  });

  test('writing to sqlite files creates symlinks', async () => {
    await idb.openDatabase();
    await sqlite.init();
    await init();

    await writeFile('/documents/db.sqlite', 'some junk');

    expect(await readFile('/documents/db.sqlite')).toBe('some junk');
    expect(await readFile('/blocked/' + pathToId('/documents/db.sqlite'))).toBe(
      'some junk',
    );
  });

  test('files are restored from idb', async () => {
    const db = await idb.openDatabase();
    const { store } = idb.getStore(db, 'files');
    await idb.set(store, {
      filepath: '/documents/ok.txt',
      contents: 'oh yeah',
    });
    await idb.set(store, {
      filepath: '/documents/deep/nested/file/ok.txt',
      contents: 'deeper',
    });
    await idb.set(store, {
      filepath: '/documents/deep/nested/db.sqlite',
      contents: 'this will be blank and just create a symlink',
    });

    await sqlite.init();
    await init();

    expect(await readFile('/documents/ok.txt')).toBe('oh yeah');
    expect(await exists('/documents/deep')).toBe(true);
    expect(await readFile('/documents/deep/nested/file/ok.txt')).toBe('deeper');

    const FS = sqlite._getModule().FS;
    const { node } = FS.lookupPath('/documents/deep/nested/db.sqlite', {});
    expect(node.link).toBe(
      '/blocked/' + pathToId('/documents/deep/nested/db.sqlite'),
    );
  });

  test('files under a custom document dir are persisted', async () => {
    await idb.openDatabase();
    await sqlite.init();
    await init();

    _setDocumentDir('/budget');

    expect(await exists('/budget')).toBe(true);

    await writeFile('/budget/foo.txt', 'hello');
    expect(await readFile('/budget/foo.txt')).toBe('hello');

    const db = await idb.openDatabase();
    const { store } = idb.getStore(db, 'files');
    expect(await idb.get(store, '/budget/foo.txt')).toEqual({
      filepath: '/budget/foo.txt',
      contents: 'hello',
    });

    // sqlite files are symlinked into the blocked fs
    await writeFile('/budget/db.sqlite', 'some junk');
    expect(await readFile('/blocked/' + pathToId('/budget/db.sqlite'))).toBe(
      'some junk',
    );

    await idb.closeDatabase();
  });

  test('files under a custom document dir are restored from idb', async () => {
    const db = await idb.openDatabase();
    const { store } = idb.getStore(db, 'files');
    await idb.set(store, {
      filepath: '/custom/xyz/metadata.json',
      contents: '{"id":"xyz"}',
    });
    await idb.set(store, {
      filepath: '/custom/xyz/db.sqlite',
      contents: 'this will be blank and just create a symlink',
    });

    await sqlite.init();
    await init();
    _setDocumentDir('/custom');

    expect(await readFile('/custom/xyz/metadata.json')).toBe('{"id":"xyz"}');

    const FS = sqlite._getModule().FS;
    const { node } = FS.lookupPath('/custom/xyz/db.sqlite', {});
    expect(node.link).toBe('/blocked/' + pathToId('/custom/xyz/db.sqlite'));
  });
});

// Fork-only (sc-5219, native-durable-writes D2, D5): the real blocked fs and
// patched backend in fallback mode, as the iPhone and Mac shells run them
describe('storage state of the blocked fs', () => {
  // Fails `times` readwrite transactions; everything else runs as usual
  function failWrites(times = Infinity) {
    const transaction = IDBDatabase.prototype.transaction;
    let left = times;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase,
      stores: string | string[],
      mode?: IDBTransactionMode,
    ) {
      if (mode === 'readwrite' && left > 0) {
        left--;
        throw new DOMException('full', 'QuotaExceededError');
      }
      return transaction.call(this, stores, mode);
    });
  }

  async function openFile(name: string) {
    await idb.openDatabase();
    await sqlite.init();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('SharedArrayBuffer', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('')),
    );
    await init();
    const FS = sqlite._getModule().FS;
    const stream = FS.open(`/blocked/${name}`, 'w+');
    const write = (byte: number) => {
      // A first block carries SQLite's page size, big-endian at offset 16
      const page = new Uint8Array(4096).fill(byte);
      page.set([0x10, 0], 16);
      FS.write(stream, page, 0, 4096, 0);
      stream.stream_ops.fsync(stream);
    };
    // Under SQLite's write lock, so the safety check runs
    const lockedWrite = (byte: number) => {
      stream.node.contents.lock(4);
      write(byte);
      stream.node.contents.unlock(1);
    };
    return { write, lockedWrite, close: () => FS.close(stream) };
  }

  beforeEach(() => {
    vi.mocked(connection.send).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('reports a stored write of the open file', async () => {
    const file = await openFile('stored');
    file.write(1);
    await whenPersisted();
    expect(storageState()).toMatchObject({
      failed: false,
      lastStoredFlushAt: expect.any(Number),
    });
  });

  test('with the guard off, a failed write is unseen and only the safety check alerts, as in stock', async () => {
    const file = await openFile('guard-off');
    file.lockedWrite(1);
    await whenPersisted();
    failWrites(1);
    file.lockedWrite(2);
    await whenPersisted();
    expect(storageState()).toMatchObject({ failed: false, quota: false });
    expect(connection.send).not.toHaveBeenCalled();
    file.lockedWrite(3);
    await whenPersisted();
    expect(vi.mocked(connection.send).mock.calls).toEqual([
      ['fallback-write-error'],
    ]);
  });

  test('with the guard on, latches and reports a failed write of the open file', async () => {
    const file = await openFile('open');
    enableStorageLatch();
    failWrites();
    file.write(1);
    await expect(whenPersisted()).rejects.toThrow('full');
    expect(storageState()).toMatchObject({ failed: true, quota: true });
    // Not the safety check, so not the one-tab message
    expect(connection.send).not.toHaveBeenCalledWith('fallback-write-error');
    expect(connection.send).toHaveBeenCalledWith('storage-failed', {
      lastStoredFlushAt: null,
      quota: true,
    });
  });

  test("records and reports a closed file's failed last write without latching", async () => {
    const file = await openFile('closed');
    enableStorageLatch();
    failWrites();
    file.write(1);
    file.close();
    await whenPersisted();
    expect(storageState()).toMatchObject({
      failed: false,
      closeFailed: true,
    });
    expect(connection.send).toHaveBeenCalledWith('storage-close-failed');
    expect(connection.send).not.toHaveBeenCalledWith(
      'storage-failed',
      expect.anything(),
    );
  });
});

describe('join', () => {
  test('basic join works', () => {
    expect(join('foo', 'bar')).toBe('foo/bar');
    expect(join('/foo', 'bar')).toBe('/foo/bar');
    expect(join('/foo', '../bar')).toBe('/bar');
  });
});
