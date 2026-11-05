import * as api from '@actual-app/api';

import { openBudget } from './connection';
import type { RemoteConfig } from './remote-config';

vi.mock('@actual-app/api', () => ({
  init: vi.fn(async () => undefined),
  downloadBudget: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
  internal: null,
}));

const config: RemoteConfig = {
  serverUrl: 'https://actual-staging.owl-becrux.ts.net',
  password: 'pw',
  syncId: 'sync',
  encryptionPassword: undefined,
  dataDir: '/tmp/actual-mcp-remote-test',
  env: 'staging',
  writes: true,
  auditLog: '/tmp/actual-mcp-remote-test.audit.jsonl',
  secrets: ['pw'],
  listen: { host: '127.0.0.1', port: 0 },
  allowedHosts: ['localhost'],
  allowedOrigins: [],
  syncIntervalMs: 300_000,
  rate: { perEndpoint: 60, perClient: 30, perPrefix: 1000, windowMs: 60_000 },
  oauth: {} as RemoteConfig['oauth'],
};

describe('the hosted entry runs the engine read-write', () => {
  beforeEach(() => vi.mocked(api.init).mockClear());

  it('A hosted sync runs the engine as the app does', async () => {
    // Like the stdio `--writes` entry: writes sync and push (sc-2486).
    await openBudget(config);
    expect(api.init).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: false, dataDir: config.dataDir }),
    );
  });
});
