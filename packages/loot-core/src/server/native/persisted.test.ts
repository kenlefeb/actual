import type * as ConnectionModule from '#platform/server/connection';
import type * as FsModule from '#platform/server/fs';
// Fork-only (sc-5219, openspec/changes/native-durable-writes D4, D5). The
// storage barrier native code calls after each write, and the latch check
// the page makes before forwarding one. The patched storage itself is
// covered on fake-indexeddb in platform/server/fs/durable-writes.test.ts;
// here the fs layer's two functions are stood in for, since the blocked fs
// is off under test.
import * as db from '#server/db';
import * as prefs from '#server/prefs';

import { app } from './app';

const storage = vi.hoisted(() => ({
  whenPersisted: vi.fn<() => Promise<void>>(),
  storageState: vi.fn(),
}));

vi.mock('#platform/server/fs', async original => ({
  ...(await original<typeof FsModule>()),
  whenPersisted: storage.whenPersisted,
  storageState: storage.storageState,
}));

const sent = vi.hoisted(() => [] as [string, unknown][]);
vi.mock('#platform/server/connection', async original => ({
  ...(await original<typeof ConnectionModule>()),
  send: (name: string, payload: unknown) => {
    sent.push([name, payload]);
  },
}));

const h = app.handlers;
const healthy = { failed: false, lastStoredFlushAt: 1000, quota: false };

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  storage.whenPersisted.mockReset().mockResolvedValue(undefined);
  storage.storageState.mockReset().mockReturnValue(healthy);
  sent.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('native/persisted', () => {
  it('answers stored once every pending write fired complete', async () => {
    expect(await h['native/persisted']()).toEqual({ stored: true });
  });

  it('answers not stored after native-persist-wait-ms, and reports stored later', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    storage.whenPersisted.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      }),
    );
    await db.update('preferences', {
      id: 'native-persist-wait-ms',
      value: '3000',
    });
    const answer = h['native/persisted']();
    await vi.advanceTimersByTimeAsync(2999);
    let settled = false;
    void answer.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ stored: false });
    expect(sent).toEqual([]);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([['storage-stored', undefined]]);
  });

  it('refuses with not-stored once storage failed', async () => {
    storage.storageState.mockReturnValue({ ...healthy, failed: true });
    await expect(h['native/persisted']()).rejects.toThrow(
      /^\[native:not-stored\] /,
    );
    expect(storage.whenPersisted).not.toHaveBeenCalled();
  });

  it('refuses with not-stored when a pending write fails', async () => {
    storage.whenPersisted.mockRejectedValue(new Error('aborted'));
    await expect(h['native/persisted']()).rejects.toThrow(
      /^\[native:not-stored\] /,
    );
  });
});

describe('native/storage-state', () => {
  it('returns the latch, the last stored flush time and quota, at once', async () => {
    expect(await h['native/storage-state']()).toEqual(healthy);
    storage.storageState.mockReturnValue({
      failed: true,
      lastStoredFlushAt: null,
      quota: true,
    });
    expect(await h['native/storage-state']()).toEqual({
      failed: true,
      lastStoredFlushAt: null,
      quota: true,
    });
    expect(storage.whenPersisted).not.toHaveBeenCalled();
  });
});
