// Fork-only (sc-5219, openspec/changes/native-durable-writes D6): sync sends
// only changes stored on this device. It waits for local storage, at most
// `native-persist-wait-ms`, sends nothing that round when the wait passes,
// and neither sends nor receives once storage has failed. The patched storage
// is stood in for: the blocked fs is off under test.
import { Timestamp } from '@actual-app/crdt';

import type * as FsModule from '#platform/server/fs';
import * as db from '#server/db';
import * as prefs from '#server/prefs';
import * as mockSyncServer from '#server/tests/mockSyncServer';

import * as encoder from './encoder';
import { isError } from './utils';

import { applyMessages, fullSync, setSyncingMode } from './index';

const storage = vi.hoisted(() => ({
  whenPersisted: vi.fn<() => Promise<void>>(),
  storageState: vi.fn(),
}));

vi.mock('#platform/server/fs', async original => ({
  ...(await original<typeof FsModule>()),
  whenPersisted: storage.whenPersisted,
  storageState: storage.storageState,
}));

const healthy = { failed: false, lastStoredFlushAt: null, quota: false };
// The time helpers the test setup adds
const time = global as unknown as {
  stepForwardInTime(at?: number): void;
  resetTime(): void;
};
const server = mockSyncServer.handlers as Record<
  string,
  (data: Uint8Array) => Promise<Uint8Array>
>;

beforeEach(async () => {
  mockSyncServer.reset();
  setSyncingMode('enabled');
  storage.whenPersisted.mockReset().mockResolvedValue(undefined);
  storage.storageState.mockReset().mockReturnValue(healthy);
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await prefs.savePrefs({
    groupId: 'group',
    lastSyncedTimestamp: Timestamp.zero.toString(),
  });
});

afterEach(() => {
  time.resetTime();
  setSyncingMode('disabled');
});

async function localChange() {
  time.stepForwardInTime(Date.parse('1970-01-03T10:17:37.000Z'));
  await applyMessages([
    {
      dataset: 'transactions',
      row: 'foo',
      column: 'amount',
      value: 5000,
      timestamp: Timestamp.send() as Timestamp,
    },
  ]);
}

async function remoteChange() {
  await server['/sync/sync'](
    await encoder.encode(
      'group',
      'client',
      Timestamp.parse('1970-01-01T01:17:37.000Z-0000-0000testinguuid2')!,
      [
        {
          dataset: 'transactions',
          row: 'bar',
          column: 'amount',
          value: 'N:3200',
          timestamp: Timestamp.parse(
            '1970-01-02T05:17:36.789Z-0000-0000testinguuid2',
          )!,
        },
      ],
    ),
  );
}

const reasonOf = (result: Awaited<ReturnType<typeof fullSync>>) =>
  isError(result) ? result.error.reason : null;

describe('sync sends only stored changes', () => {
  it('sends nothing until local storage says the changes are stored', async () => {
    await localChange();
    let stored: () => void = () => undefined;
    storage.whenPersisted.mockReturnValueOnce(
      new Promise<void>(resolve => {
        stored = resolve;
      }),
    );
    const syncing = fullSync();
    await vi.waitFor(() => expect(storage.whenPersisted).toHaveBeenCalled());
    expect(mockSyncServer.getMessages()).toHaveLength(0);
    stored();
    expect(reasonOf(await syncing)).toBeNull();
    expect(mockSyncServer.getMessages()).toHaveLength(1);
  });

  it('on hung storage, sends nothing after the wait and tries again next round', async () => {
    await db.update('preferences', {
      id: 'native-persist-wait-ms',
      value: '100',
    });
    // Saving the preference is itself a synced change, sent at once
    const sent = mockSyncServer.getMessages().length;
    await localChange();
    storage.whenPersisted.mockReturnValueOnce(
      new Promise<void>(() => undefined),
    );
    storage.whenPersisted.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const syncing = fullSync();
    await vi.waitFor(() => expect(storage.whenPersisted).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(100);
    expect(reasonOf(await syncing)).toBeNull();
    vi.useRealTimers();
    expect(mockSyncServer.getMessages()).toHaveLength(sent);
    // The messages were kept, and the next sync sends them
    expect(reasonOf(await fullSync())).toBeNull();
    expect(mockSyncServer.getMessages()).toHaveLength(sent + 1);
  });

  it('sends and receives nothing once storage has failed, and reports it', async () => {
    await remoteChange();
    await localChange();
    storage.storageState.mockReturnValue({ ...healthy, failed: true });
    expect(reasonOf(await fullSync())).toBe('storage-failed');
    expect(mockSyncServer.getMessages()).toHaveLength(1);
    expect(
      await db.all("SELECT * FROM messages_crdt WHERE row = 'bar'"),
    ).toEqual([]);
  });

  it('leaves one copy on the server when a refused change is made again after reload', async () => {
    await localChange();
    storage.storageState.mockReturnValue({ ...healthy, failed: true });
    expect(reasonOf(await fullSync())).toBe('storage-failed');
    // Reload: the device is back at its last stored state, without the change
    storage.storageState.mockReturnValue(healthy);
    await global.emptyDatabase()();
    await prefs.loadPrefs();
    await prefs.savePrefs({
      groupId: 'group',
      lastSyncedTimestamp: Timestamp.zero.toString(),
    });
    await localChange();
    expect(reasonOf(await fullSync())).toBeNull();
    expect(
      mockSyncServer.getMessages().filter(m => m.row === 'foo'),
    ).toHaveLength(1);
  });

  it('treats a write that fails while waiting as a storage failure', async () => {
    await localChange();
    storage.whenPersisted.mockRejectedValueOnce(new Error('aborted'));
    expect(reasonOf(await fullSync())).toBe('storage-failed');
    expect(mockSyncServer.getMessages()).toHaveLength(0);
  });
});
