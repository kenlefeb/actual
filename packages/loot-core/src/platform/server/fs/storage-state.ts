// Fork-only (sc-5219, openspec/changes/native-durable-writes D2). The patched
// absurd-sql backend's state across its files. Only a file with open handles
// (the open budget) can latch; a closed budget's writes are still waited for.
export type FilesStorageState = {
  failed: boolean;
  lastStoredFlushAt: number | null;
  quota: boolean;
};

export type StorageState = FilesStorageState & {
  // The last write of a budget closed in this session failed (D7a)
  closeFailed: boolean;
};

export type StorageFile = {
  filename: string;
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

/**
 * Whether these ops belong to an open file. Named by its ops, since a
 * reopened budget has a new file under the same name.
 */
export function isOpenFile(
  files: Iterable<Pick<StorageFile, 'ops' | 'openHandles'>>,
  ops: unknown,
) {
  return [...files].some(file => file.ops === ops && file.openHandles > 0);
}

/**
 * Resolves when the open budget's writes so far are stored, including those of
 * earlier files of its name; rejects if an open file's failed. Another
 * budget's stuck write must not hold this one back. With nothing open, every
 * file counts. A lifecycle flush asks for `allFiles`, so a budget just closed
 * is covered even when another has opened since (D8).
 */
export async function filesWhenPersisted(
  files: Iterable<StorageFile>,
  { allFiles = false }: { allFiles?: boolean } = {},
) {
  const all = [...files];
  const openNames = new Set(
    all.filter(file => file.openHandles > 0).map(file => file.filename),
  );
  const waitedFor =
    !allFiles && openNames.size > 0
      ? all.filter(file => openNames.has(file.filename))
      : all;
  await Promise.all(
    waitedFor.map(async file => {
      try {
        await file.ops.whenPersisted?.();
      } catch (error) {
        if (file.openHandles > 0) throw error;
      }
    }),
  );
}

export function filesStorageState(
  files: Iterable<StorageFile>,
): FilesStorageState {
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
