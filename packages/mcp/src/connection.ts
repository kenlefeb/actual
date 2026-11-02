import * as api from '@actual-app/api';

import type { McpConfig } from './config';

let userId = 'unknown';

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
    await api.init(
      config.sessionToken
        ? { ...base, sessionToken: config.sessionToken }
        : { ...base, password: config.password ?? '' },
    );
  } catch {
    throw new Error('Could not sign in to the Actual server');
  }
  userId = await lookupUserId(api.internal);
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
  await api.shutdown();
}
