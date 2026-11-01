import * as api from '@actual-app/api';

import type { McpConfig } from './config';

/**
 * Signs in and loads the budget. Failures carry fixed text only: the
 * underlying error can echo the URL or server response, so it is dropped.
 */
export async function openBudget(config: McpConfig) {
  try {
    await api.init({
      serverURL: config.serverUrl,
      dataDir: config.dataDir,
      password: config.password,
      // The read entry writes and pushes nothing; --writes runs the engine as the app does
      readOnly: !config.writes,
    });
  } catch {
    throw new Error('Could not sign in to the Actual server');
  }
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
