import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import type { IncomingHttpHeaders } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import * as api from '@actual-app/api';

import { loadConfig } from './config';
import { actingUserId, closeBudget, openBudget } from './connection';
import { loadRemoteConfig } from './remote-config';

const TOKEN = 'minted-session-token-0123456789';

type Extra = Record<string, string | undefined>;

function secretFile(content: string, mode = 0o400) {
  const dir = mkdtempSync(join(tmpdir(), 'actual-mcp-token-'));
  const file = join(dir, 'secret');
  writeFileSync(file, `${content}\n`);
  chmodSync(file, mode);
  return file;
}

const stdioEnv = (extra: Extra = {}) => ({
  ACTUAL_SERVER_URL: 'http://127.0.0.1:5006',
  ACTUAL_SYNC_ID: 'sync-1',
  ACTUAL_SESSION_TOKEN_FILE: secretFile(TOKEN),
  ...extra,
});

const remoteEnv = (extra: Extra = {}) => ({
  ACTUAL_SERVER_URL: 'https://actual-staging.owl-becrux.ts.net',
  ACTUAL_SYNC_ID: 'sync-1',
  ACTUAL_SESSION_TOKEN_FILE: secretFile(TOKEN),
  ACTUAL_MCP_PUBLIC_URL: 'https://mcp-staging.example.test',
  ACTUAL_MCP_SIGNING_KEY_FILE: secretFile(
    'signing-key-0123456789abcdef0123456789abcdef',
    0o600,
  ),
  ACTUAL_MCP_CLIENT_ID: 'claude-staging',
  ACTUAL_MCP_CLIENT_SECRET_FILE: secretFile(
    'registered-client-secret-0123456789abcdef',
    0o600,
  ),
  ACTUAL_MCP_IDP_ISSUER: 'https://accounts.google.com',
  ACTUAL_MCP_IDP_AUTHORIZATION_URL:
    'https://accounts.google.com/o/oauth2/v2/auth',
  ACTUAL_MCP_IDP_TOKEN_URL: 'https://oauth2.googleapis.com/token',
  ACTUAL_MCP_IDP_CLIENT_ID: 'idp-client.apps.example.test',
  ACTUAL_MCP_IDP_CLIENT_SECRET_FILE: secretFile('idp-client-secret', 0o600),
  ACTUAL_MCP_ALLOWED_ACCOUNT: 'agent@example.test',
  ...extra,
});

describe.each([
  ['stdio', (extra: Extra) => loadConfig(stdioEnv(extra))],
  ['hosted', (extra: Extra) => loadRemoteConfig(remoteEnv(extra))],
])('session token (%s entry)', (_name, load) => {
  it('A token file replaces the password', () => {
    const config = load({});
    expect(config.sessionToken).toBe(TOKEN);
    expect(config.password).toBeUndefined();
    expect(config.secrets).toContain(TOKEN);
  });

  it('A token file that is not 0400 is refused', () => {
    for (const mode of [0o600, 0o440, 0o404, 0o200]) {
      const file = secretFile(TOKEN, mode);
      let message = '';
      try {
        load({ ACTUAL_SESSION_TOKEN_FILE: file });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/0400/);
      expect(message).not.toContain(file);
      expect(message).not.toContain(TOKEN);
    }
  });

  it('A token and a password together are refused', () => {
    expect(() =>
      load({
        ACTUAL_PASSWORD: 'hunter2',
        ACTUAL_PASSWORD_FILE: secretFile('hunter2', 0o600),
      }),
    ).toThrow(/exactly one/i);
  });

  it('A token in an environment value is refused', () => {
    expect(() =>
      load({
        ACTUAL_SESSION_TOKEN_FILE: undefined,
        ACTUAL_SESSION_TOKEN: TOKEN,
      }),
    ).toThrow(/ACTUAL_SESSION_TOKEN_FILE/);
    expect(() => load({ ACTUAL_SESSION_TOKEN: TOKEN })).toThrow(/file/);
  });

  it('No credential at all is refused', () => {
    expect(() => load({ ACTUAL_SESSION_TOKEN_FILE: undefined })).toThrow(
      /exactly one/i,
    );
  });
});

describe('sign-in with a session token', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeBudget();
  });

  it('init gets the token and no password', async () => {
    const init = vi.spyOn(api, 'init').mockRejectedValue(new Error('stop'));
    await openBudget(loadConfig(stdioEnv())).catch(() => null);
    const arg = init.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.sessionToken).toBe(TOKEN);
    expect(arg).not.toHaveProperty('password');
  });

  it('The audit-identity lookup works after a token sign-in', async () => {
    const seen: IncomingHttpHeaders[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers);
      res.setHeader('content-type', 'application/json');
      res.end(
        req.url === '/account/validate'
          ? JSON.stringify({
              status: 'ok',
              data: { userId: 'user-assistant', permission: 'BASIC' },
            })
          : JSON.stringify({ status: 'error', reason: 'unauthorized' }),
      );
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const config = loadConfig(
        stdioEnv({
          ACTUAL_SERVER_URL: url,
          ACTUAL_DATA_DIR: mkdtempSync(
            join(tmpdir(), 'actual-mcp-token-data-'),
          ),
        }),
      );
      // The stub has no budget, so loading fails after the identity is read.
      await expect(openBudget(config)).rejects.toThrow(
        'Could not load the budget',
      );
      expect(actingUserId()).toBe('user-assistant');
      expect(seen.some(h => h['x-actual-token'] === TOKEN)).toBe(true);
    } finally {
      server.close();
    }
  });
});
