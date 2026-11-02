import * as api from '@actual-app/api';

import type { McpConfig } from './config';
import { openBudget } from './connection';

vi.mock('@actual-app/api', () => ({
  init: vi.fn(async () => undefined),
  downloadBudget: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
  internal: null,
}));

const config = (writes: boolean): McpConfig => ({
  serverUrl: 'http://localhost:5006',
  password: 'pw',
  syncId: 'sync',
  encryptionPassword: undefined,
  dataDir: '/tmp/actual-mcp-test',
  env: 'local',
  writes,
  auditLog: '',
  secrets: ['pw'],
});

describe('openBudget engine mode', () => {
  beforeEach(() => vi.mocked(api.init).mockClear());

  it('The read entry starts the engine read-only', async () => {
    await openBudget(config(false));
    expect(api.init).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true }),
    );
  });

  it('The writes entry runs the engine normally', async () => {
    await openBudget(config(true));
    expect(api.init).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: false }),
    );
  });
});
