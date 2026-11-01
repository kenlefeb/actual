import * as api from '@actual-app/api';

import type { RegisterTool } from '#tools/read/shared';

type SyncState = {
  lastSuccess: string | null;
  lastAttempt: string | null;
  lastAttemptFailed: boolean;
};

let state: SyncState = {
  lastSuccess: null,
  lastAttempt: null,
  lastAttemptFailed: false,
};
let queue: Promise<unknown> = Promise.resolve();

export function resetSyncState() {
  state = { lastSuccess: null, lastAttempt: null, lastAttemptFailed: false };
  queue = Promise.resolve();
}

/** Marks the sync that opened the budget (the download) as a success. */
export function recordSync(ok: boolean) {
  const now = new Date().toISOString();
  state = {
    lastSuccess: ok ? now : state.lastSuccess,
    lastAttempt: now,
    lastAttemptFailed: !ok,
  };
}

/**
 * Pulls the server's changes. Calls run one at a time, so the schedule and a
 * `sync_budget` tool call never overlap; the outcome is kept for
 * `get_sync_status`. A failure rejects but leaves the last copy in place.
 */
export function syncNow(): Promise<void> {
  const run = queue.then(async () => {
    try {
      await api.sync();
      recordSync(true);
    } catch (error) {
      recordSync(false);
      throw error;
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

export function syncStatus() {
  return {
    last_success: state.lastSuccess,
    last_attempt: state.lastAttempt,
    last_attempt_failed: state.lastAttemptFailed,
  };
}

/** Syncs on an interval; a failure is recorded and the schedule goes on. Returns a stop function. */
export function startSyncSchedule(intervalMs: number) {
  const timer = setInterval(() => {
    syncNow().catch(() => undefined);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function registerSyncStatusTool(tool: RegisterTool) {
  tool(
    'get_sync_status',
    'When this copy last synced successfully, and whether the latest sync attempt failed. A failed sync leaves the last copy in use.',
    {},
    async () => syncStatus(),
  );
}
