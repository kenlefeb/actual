// Fork-only (sc-5219, openspec/changes/native-durable-writes D4, D5). The
// storage barrier native code calls after each write, and the latch check
// the page makes before forwarding one. The patched storage itself is
// covered on fake-indexeddb in platform/server/fs/durable-writes.test.ts;
// here the fs layer's two functions are stood in for, since the blocked fs
// is off under test.
import * as connection from '#platform/server/connection';
import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import * as prefs from '#server/prefs';

import { app } from './app';
import { setSyncHeld, storageGuardEnabled } from './persisted';

const h = app.handlers;
const healthy = {
  failed: false,
  lastStoredFlushAt: 1000,
  quota: false,
  closeFailed: false,
};
const storage = {
  whenPersisted: vi.spyOn(fs, 'whenPersisted'),
  storageState: vi.spyOn(fs, 'storageState'),
  enableStorageLatch: vi.spyOn(fs, 'enableStorageLatch'),
};
const send = vi.spyOn(connection, 'send');

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  storage.whenPersisted.mockReset().mockResolvedValue(undefined);
  storage.storageState.mockReset().mockReturnValue(healthy);
  send.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// Must stay first: the switch is one-way
describe('the storage guard', () => {
  it('stays off until the native bridge turns it on, and turns on once', async () => {
    await h['native/storage-state']();
    await h['native/persisted']();
    expect(storageGuardEnabled()).toBe(false);
    expect(storage.enableStorageLatch).not.toHaveBeenCalled();
    await h['native/enable-storage-guard']();
    await h['native/enable-storage-guard']();
    expect(storageGuardEnabled()).toBe(true);
    expect(storage.enableStorageLatch).toHaveBeenCalledTimes(1);
  });
});

describe('native/persisted', () => {
  it('answers stored once every pending write fired complete', async () => {
    expect(await h['native/persisted']()).toEqual({
      stored: true,
      seq: { epoch: expect.any(String), n: expect.any(Number) },
    });
  });

  // A restarted page is a new engine: native code must tell its answers apart
  it('names this page load in every answer and event', async () => {
    const { epoch } = (await h['native/persisted']()).seq;
    expect(epoch).not.toBe('');
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    storage.whenPersisted.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      }),
    );
    const answer = h['native/persisted']();
    await vi.advanceTimersByTimeAsync(2000);
    const late = await answer;
    expect(late.seq.epoch).toBe(epoch);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith('storage-stored', { seq: late.seq });
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
    const { seq } = await answer;
    expect(await answer).toEqual({
      stored: false,
      seq: { epoch: expect.any(String), n: expect.any(Number) },
    });
    expect(send).not.toHaveBeenCalledWith('storage-stored', expect.anything());
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith('storage-stored', { seq });
  });

  it('reports stored per call, so a later write still pending is not covered', async () => {
    vi.useFakeTimers();
    const finish: Array<() => void> = [];
    storage.whenPersisted.mockImplementation(
      () => new Promise<void>(resolve => finish.push(resolve)),
    );
    const first = h['native/persisted']();
    await vi.advanceTimersByTimeAsync(2000);
    const second = h['native/persisted']();
    await vi.advanceTimersByTimeAsync(2000);
    const [{ seq: firstSeq }, { seq: secondSeq }] = await Promise.all([
      first,
      second,
    ]);
    expect(secondSeq).not.toBe(firstSeq);
    finish[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls).toEqual([['storage-stored', { seq: firstSeq }]]);
  });

  // A lifecycle flush can come with no budget open, so no preferences to read
  it('still answers with no budget open', async () => {
    db.closeDatabase();
    expect(await h['native/persisted']()).toMatchObject({ stored: true });
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
  it('does not call a sync held once storage has failed', async () => {
    setSyncHeld(true);
    expect((await h['native/storage-state']()).syncHeld).toBe(true);
    storage.storageState.mockReturnValue({ ...healthy, failed: true });
    expect((await h['native/storage-state']()).syncHeld).toBe(false);
    setSyncHeld(false);
  });

  it('returns the latch, the last stored flush time and quota, at once', async () => {
    expect(await h['native/storage-state']()).toEqual({
      ...healthy,
      syncHeld: false,
    });
    const failed = {
      failed: true,
      lastStoredFlushAt: null,
      quota: true,
      closeFailed: true,
    };
    storage.storageState.mockReturnValue(failed);
    expect(await h['native/storage-state']()).toEqual({
      ...failed,
      syncHeld: false,
    });
    expect(storage.whenPersisted).not.toHaveBeenCalled();
  });
});
