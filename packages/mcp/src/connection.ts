import * as api from '@actual-app/api';

import type { McpConfig } from './config';

let userId = 'unknown';
let engine: Awaited<ReturnType<typeof api.init>> | null = null;

/**
 * The engine `api.init()` returned. Read it here, not from `api.internal`: the
 * API's CJS build reaches Node's ESM loader as a snapshot taken at import, so
 * `api.internal` stays null in the shipped server (tests run from source).
 */
export function internal() {
  return engine;
}

/** `api.init`, keeping the engine for `internal()`. */
export async function initEngine(config: Parameters<typeof api.init>[0]) {
  engine = await api.init(config);
  return engine;
}

/** The sync-server user id the connection signed in as, or `unknown`. An id, never a token. */
export function actingUserId() {
  return userId;
}

/** Asks the signed-in server for its user id; any failure is `unknown`, never an error. */
export async function lookupUserId(
  internal: { send: (name: 'subscribe-get-user') => Promise<unknown> } | null,
) {
  try {
    const user = (await internal?.send('subscribe-get-user')) as
      | { userId?: unknown }
      | null
      | undefined;
    return typeof user?.userId === 'string' && user.userId
      ? user.userId
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Signs in and loads the budget. Failures carry fixed text only: the
 * underlying error can echo the URL or server response, so it is dropped.
 */
export async function openBudget(config: McpConfig) {
  try {
    const base = {
      serverURL: config.serverUrl,
      dataDir: config.dataDir,
      // The read entry writes and pushes nothing; --writes runs the engine as the app does
      readOnly: !config.writes,
    };
    await initEngine(
      config.sessionToken
        ? { ...base, sessionToken: config.sessionToken }
        : { ...base, password: config.password ?? '' },
    );
  } catch {
    throw new Error('Could not sign in to the Actual server');
  }
  userId = await lookupUserId(internal());
  try {
    await api.downloadBudget(config.syncId, {
      password: config.encryptionPassword,
    });
  } catch {
    await closeBudget();
    throw new Error('Could not load the budget');
  }
}

export async function closeBudget() {
  engine = null;
  await api.shutdown();
}
