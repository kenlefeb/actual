import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
});
