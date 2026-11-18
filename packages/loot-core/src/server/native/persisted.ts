// Fork-only (sc-5219, openspec/changes/native-durable-writes D4, D5). In the
// iPhone and Mac shells absurd-sql runs in fallback mode, where a write is
// stored only when its IndexedDB transaction completes. Native code follows
// every write with `native/persisted`, and the page asks
// `native/storage-state` before forwarding one. Off the shells both answer
// at once: writes there are durable when they return.
import * as connection from '#platform/server/connection';
import * as fs from '#platform/server/fs';

import { readLimit } from './limits';
import { nativeRefusal } from './refusal';

function notStored() {
  return nativeRefusal(
    'not-stored',
    'native/persisted: changes can no longer be stored on this device',
  );
}

/**
 * Stored once every pending write fired complete, or not yet stored after
 * `native-persist-wait-ms`; then a `storage-stored` event follows when they
 * do. Refuses once the failed latch is set.
 */
/** Whether the failed latch is set: nothing more is stored until reload. */
export function storageFailed(): boolean {
  return fs.storageState().failed;
}

export async function persisted(): Promise<{ stored: boolean }> {
  if (storageFailed()) throw notStored();
  const outcome = await waitForStorage().catch(() => {
    throw notStored();
  });
  if (!('pending' in outcome)) return { stored: true };
  // The page tells native code when the writes do land; a failure instead
  // latches and sends storage-failed
  outcome.pending.then(
    () => connection.send('storage-stored'),
    () => undefined,
  );
  return { stored: false };
}

/**
 * Every write so far stored, or not yet after `native-persist-wait-ms`, with
 * the still-pending promise. Rejects when a write fails. Shared with sync,
 * which sends only stored changes (D6).
 */
export async function waitForStorage(): Promise<
  { stored: true } | { stored: false; pending: Promise<void> }
> {
  const wait = await readLimit('native-persist-wait-ms');
  const pending = fs.whenPersisted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), wait);
  });
  try {
    const outcome = await Promise.race([pending, timedOut]);
    return outcome === 'timeout'
      ? { stored: false, pending }
      : { stored: true };
  } finally {
    clearTimeout(timer);
  }
}

/** The failed latch, when the last stored write was flushed, and whether storage is full. */
export async function storageState(): Promise<fs.StorageState> {
  return fs.storageState();
}
