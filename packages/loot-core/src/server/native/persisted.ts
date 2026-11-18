// Fork-only (sc-5219, openspec/changes/native-durable-writes D4, D5). In the
// iPhone and Mac shells absurd-sql runs in fallback mode, where a write is
// stored only when its IndexedDB transaction completes. Native code follows
// every write with `native/persisted`, and the page asks
// `native/storage-state` before forwarding one. Off the shells both answer
// at once: writes there are durable when they return.
import * as connection from '#platform/server/connection';
import * as fs from '#platform/server/fs';
import type { StorageState } from '#platform/server/fs/storage-state';

import { LIMITS, readLimit } from './limits';
import { nativeRefusal } from './refusal';

// The storage guard (D7a). Off for every client until the native bridge turns
// it on as it installs: no latch, no sync gate, and storage failures behave as
// in stock absurd-sql
let storageGuard = false;

export const storageGuardEnabled = () => storageGuard;

/** `native/enable-storage-guard`. One-way; only the native bridge should call it. */
export async function enableStorageGuard(): Promise<void> {
  if (storageGuard) return;
  storageGuard = true;
  fs.enableStorageLatch();
}

function notStored() {
  return nativeRefusal(
    'not-stored',
    'native/persisted: changes can no longer be stored on this device',
  );
}

/** Whether the failed latch is set: nothing more is stored until reload. */
export function storageFailed(): boolean {
  return fs.storageState().failed;
}

let lastPersistSeq = 0;

/**
 * Stored once every pending write fired complete, or not yet stored after
 * `native-persist-wait-ms`; then a `storage-stored` event with the same `seq`
 * follows once the writes this call waited for are stored. Later writes may
 * still be pending then. Refuses once the failed latch is set.
 */
export async function persisted(): Promise<{ stored: boolean; seq?: number }> {
  if (storageFailed()) throw notStored();
  const outcome = await waitForStorage().catch(() => {
    throw notStored();
  });
  if (!('pending' in outcome)) return { stored: true };
  const seq = ++lastPersistSeq;
  // A failure instead latches and sends storage-failed
  outcome.pending.then(
    () => connection.send('storage-stored', { seq }),
    () => undefined,
  );
  return { stored: false, seq };
}

/**
 * Every write so far stored, or not yet after `native-persist-wait-ms`, with
 * the still-pending promise. Rejects when a write fails. Shared with sync,
 * which sends only stored changes (D6).
 */
export async function waitForStorage(): Promise<
  { stored: true } | { stored: false; pending: Promise<void> }
> {
  // With no budget open there are no preferences to read
  const wait = await readLimit('native-persist-wait-ms').catch(
    () => LIMITS['native-persist-wait-ms'].default,
  );
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
export async function storageState(): Promise<
  StorageState & { syncHeld: boolean }
> {
  const state = fs.storageState();
  return { ...state, syncHeld: syncHeld && !state.failed };
}

// A sync is waiting on device storage (D6): the status line says so
let syncHeld = false;

export function setSyncHeld(held: boolean) {
  syncHeld = held;
}

export const isSyncHeld = () => syncHeld;
