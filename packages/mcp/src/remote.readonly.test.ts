import * as api from '@actual-app/api';

import { openBudget } from './connection';
import type { RemoteConfig } from './remote-config';

vi.mock('@actual-app/api', () => ({
  init: vi.fn(async () => undefined),
  downloadBudget: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
}));

const config: RemoteConfig = {
  serverUrl: 'https://actual-staging.owl-becrux.ts.net',
  password: 'pw',
  syncId: 'sync',
  encryptionPassword: undefined,
  dataDir: '/tmp/actual-mcp-remote-test',
  env: 'staging',
  writes: false,
  auditLog: '',
  secrets: ['pw'],
  listen: { host: '127.0.0.1', port: 0 },
  allowedHosts: ['localhost'],
  allowedOrigins: [],
  syncIntervalMs: 300_000,
  rate: { perEndpoint: 60, perClient: 30, windowMs: 60_000 },
  oauth: {} as RemoteConfig['oauth'],
};

describe('hosted means read-only, in code', () => {
  beforeEach(() => vi.mocked(api.init).mockClear());

  it('A hosted sync writes nothing', async () => {
    // The engine's read-only mode (api-read-only-mode) stops auto-posting,
    // reconcile and any push; the hosted entry must always ask for it.
    await openBudget(config);
    expect(api.init).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true, dataDir: config.dataDir }),
    );
  });
});
