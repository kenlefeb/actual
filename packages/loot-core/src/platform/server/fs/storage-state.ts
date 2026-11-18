// Fork-only (sc-5219, openspec/changes/native-durable-writes D2). The patched
// absurd-sql backend's state across its files. Only a file with open handles
// (the open budget) can latch; a closed budget's writes are still waited for.
export type StorageState = {
  failed: boolean;
  lastStoredFlushAt: number | null;
  quota: boolean;
};

export type StorageFile = {
  openHandles: number;
  ops: {
    whenPersisted?: () => Promise<void>;
    storageState?: () => {
      failed: unknown;
      lastStoredFlushAt: number | null;
      quota: boolean;
    };
  };
};

/** Resolves when every write so far is stored; rejects if an open file's failed. */
export async function filesWhenPersisted(files: Iterable<StorageFile>) {
  await Promise.all(
    [...files].map(async file => {
      try {
        await file.ops.whenPersisted?.();
      } catch (error) {
        if (file.openHandles > 0) throw error;
      }
    }),
  );
}

export function filesStorageState(files: Iterable<StorageFile>): StorageState {
  const states = [...files].flatMap(file =>
    file.openHandles > 0 && file.ops.storageState
      ? [file.ops.storageState()]
      : [],
  );
  const failed = states.find(state => state.failed);
  const stored = states.flatMap(state =>
    state.lastStoredFlushAt === null ? [] : [state.lastStoredFlushAt],
  );
  return {
    failed: Boolean(failed),
    // After a failure, the cut is the failed file's own last stored flush
    lastStoredFlushAt: failed
      ? failed.lastStoredFlushAt
      : stored.length > 0
        ? Math.max(...stored)
        : null,
    quota: Boolean(failed?.quota),
  };
}
