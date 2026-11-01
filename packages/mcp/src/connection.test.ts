import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import * as api from '@actual-app/api';

import { loadConfig } from './config';
import { closeBudget, openBudget } from './connection';

afterEach(async () => {
  await closeBudget();
});

describe('openBudget', () => {
  it('A failed sign-in', async () => {
    const password = 'wrong-password-123';
    const encryptionPassword = 'enc-key-456';
    const error = await openBudget({
      serverUrl: 'http://127.0.0.1:1',
      password,
      syncId: 'sync',
      encryptionPassword,
      dataDir: mkdtempSync(join(tmpdir(), 'actual-mcp-')),
      env: 'local',
      writes: false,
      auditLog: '',
      secrets: [password, encryptionPassword],
    }).then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.message).toBe('Could not sign in to the Actual server');
    expect(error?.message).not.toContain(password);
    expect(error?.message).not.toContain(encryptionPassword);
  });

  it('The writes entry opens its own data directory', async () => {
    const env = {
      ACTUAL_SERVER_URL: 'http://127.0.0.1:1',
      ACTUAL_PASSWORD: 'pw',
      ACTUAL_SYNC_ID: 'sync',
      ACTUAL_DATA_DIR: join(tmpdir(), 'actual-mcp-conn', 'shared'),
    };
    const init = vi.spyOn(api, 'init').mockRejectedValue(new Error('stop'));
    await openBudget(loadConfig(env)).catch(() => null);
    await openBudget(loadConfig(env, ['--writes'])).catch(() => null);
    expect(init.mock.calls.map(c => c[0]?.dataDir)).toEqual([
      env.ACTUAL_DATA_DIR,
      `${env.ACTUAL_DATA_DIR}-writes`,
    ]);
  });
});
