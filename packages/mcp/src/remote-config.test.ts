import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { loadRemoteConfig } from './remote-config';

function secretFile(content: string, mode = 0o600) {
  const dir = mkdtempSync(join(tmpdir(), 'actual-mcp-remote-'));
  const file = join(dir, 'secret');
  writeFileSync(file, `${content}\n`);
  chmodSync(file, mode);
  return file;
}

const CLIENT_SECRET = 'registered-client-secret-0123456789abcdef';
const KEY = 'signing-key-0123456789abcdef0123456789abcdef';

const env = (extra: Record<string, string | undefined> = {}) => ({
  ACTUAL_SERVER_URL: 'https://actual-staging.owl-becrux.ts.net',
  ACTUAL_SYNC_ID: 'sync-1',
  ACTUAL_PASSWORD_FILE: secretFile('hunter2-secret'),
  ACTUAL_MCP_PUBLIC_URL: 'https://mcp-staging.example.test',
  ACTUAL_MCP_SIGNING_KEY_FILE: secretFile(KEY),
  ACTUAL_MCP_CLIENT_ID: 'claude-staging',
  ACTUAL_MCP_CLIENT_SECRET_FILE: secretFile(CLIENT_SECRET),
  ACTUAL_MCP_IDP_ISSUER: 'https://accounts.google.com',
  ACTUAL_MCP_IDP_AUTHORIZATION_URL:
    'https://accounts.google.com/o/oauth2/v2/auth',
  ACTUAL_MCP_IDP_TOKEN_URL: 'https://oauth2.googleapis.com/token',
  ACTUAL_MCP_IDP_CLIENT_ID: 'idp-client.apps.example.test',
  ACTUAL_MCP_IDP_CLIENT_SECRET_FILE: secretFile('idp-client-secret'),
  ACTUAL_MCP_ALLOWED_ACCOUNT: 'agent@example.test',
  ...extra,
});

describe('hosted entry configuration', () => {
  it('The prefix ceiling is configurable with a default', () => {
    expect(loadRemoteConfig(env(), []).rate.perPrefix).toBe(600);
    expect(
      loadRemoteConfig(env({ ACTUAL_MCP_RATE_PER_PREFIX: '900' }), []).rate
        .perPrefix,
    ).toBe(900);
    expect(() =>
      loadRemoteConfig(env({ ACTUAL_MCP_RATE_PER_PREFIX: '0' }), []),
    ).toThrow(/ACTUAL_MCP_RATE_PER_PREFIX/);
  });

  it('A writes flag is refused', () => {
    expect(() => loadRemoteConfig(env(), ['--writes'])).toThrow(
      /read-only.*--writes/,
    );
    expect(() => loadRemoteConfig(env(), ['--anything'])).toThrow(/Usage/);
  });

  it('Production is refused', () => {
    expect(() =>
      loadRemoteConfig(
        env({
          ACTUAL_SERVER_URL: 'https://actual.example.com',
          ACTUAL_MCP_ALLOW_PRODUCTION: '1',
        }),
      ),
    ).toThrow(/staging/);
  });

  it('A second budget is a second instance', () => {
    const a = loadRemoteConfig(env());
    const b = loadRemoteConfig(env({ ACTUAL_DATA_DIR: '/tmp/x/other' }));
    expect(a.dataDir).toMatch(/actual-mcp\/staging-remote$/);
    expect(b.dataDir).toBe('/tmp/x/other-remote');
    expect(a.writes).toBe(false);
    expect(a.auditLog).toBe('');
  });

  it('Secrets are read from files', () => {
    const config = loadRemoteConfig(
      env({
        ACTUAL_ENCRYPTION_PASSWORD_FILE: secretFile('enc-key'),
      }),
    );
    expect(config.password).toBe('hunter2-secret');
    expect(config.encryptionPassword).toBe('enc-key');
    expect(config.secrets).toEqual([
      'hunter2-secret',
      'enc-key',
      KEY,
      CLIENT_SECRET,
      'idp-client-secret',
    ]);
  });

  it('A secret in the environment is not used', () => {
    expect(() =>
      loadRemoteConfig({
        ACTUAL_SERVER_URL: 'https://actual-staging.owl-becrux.ts.net',
        ACTUAL_SYNC_ID: 'sync-1',
        ACTUAL_PASSWORD: 'in-the-environment',
      }),
    ).toThrow(/ACTUAL_PASSWORD_FILE is required/);
  });

  it('A loose secret file', () => {
    for (const name of [
      'ACTUAL_PASSWORD_FILE',
      'ACTUAL_ENCRYPTION_PASSWORD_FILE',
      'ACTUAL_MCP_SIGNING_KEY_FILE',
      'ACTUAL_MCP_CLIENT_SECRET_FILE',
      'ACTUAL_MCP_IDP_CLIENT_SECRET_FILE',
    ]) {
      const loose = secretFile('very-secret-value', 0o644);
      let message = '';
      try {
        loadRemoteConfig(env({ [name]: loose }));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/missing or readable by others/);
      expect(message).not.toContain('very-secret-value');
      expect(message).not.toContain(loose);
    }
  });

  it('A missing secret file', () => {
    expect(() =>
      loadRemoteConfig(env({ ACTUAL_PASSWORD_FILE: '/nonexistent/secret' })),
    ).toThrow(/missing or readable by others/);
  });
});

describe('the OAuth settings', () => {
  it('A missing signing key file', () => {
    // The key is required: without it the entry must not start, never fall
    // back to serving unauthenticated.
    expect(() =>
      loadRemoteConfig(env({ ACTUAL_MCP_SIGNING_KEY_FILE: undefined })),
    ).toThrow(/ACTUAL_MCP_SIGNING_KEY_FILE is required/);
    expect(() =>
      loadRemoteConfig(
        env({ ACTUAL_MCP_SIGNING_KEY_FILE: '/nonexistent/signing-key' }),
      ),
    ).toThrow(/missing or readable by others/);
  });

  it('A signing key that is too short or not a file', () => {
    expect(() =>
      loadRemoteConfig(
        env({ ACTUAL_MCP_SIGNING_KEY_FILE: secretFile('too-short') }),
      ),
    ).toThrow(/signing key.*at least 32/i);
    // A directory is not a key file.
    expect(() =>
      loadRemoteConfig(env({ ACTUAL_MCP_SIGNING_KEY_FILE: tmpdir() })),
    ).toThrow(/missing or readable by others/);
  });

  it('A short client secret', () => {
    expect(() =>
      loadRemoteConfig(
        env({ ACTUAL_MCP_CLIENT_SECRET_FILE: secretFile('short-secret') }),
      ),
    ).toThrow(/client secret.*at least 32/i);
    expect(() =>
      loadRemoteConfig(
        env({ ACTUAL_MCP_CLIENT_SECRET_FILE: secretFile('x'.repeat(32)) }),
      ),
    ).not.toThrow();
  });

  it('A loopback redirect URI', () => {
    for (const uri of [
      'https://localhost/cb',
      'https://127.0.0.1:8080/cb',
      'https://[::1]/cb',
      'https://LOCALHOST/cb',
    ]) {
      expect(() =>
        loadRemoteConfig(env({ ACTUAL_MCP_REDIRECT_URIS: uri })),
      ).toThrow(/loopback/);
    }
  });

  it('Every OAuth setting is required', () => {
    for (const name of [
      'ACTUAL_MCP_PUBLIC_URL',
      'ACTUAL_MCP_CLIENT_ID',
      'ACTUAL_MCP_CLIENT_SECRET_FILE',
      'ACTUAL_MCP_IDP_ISSUER',
      'ACTUAL_MCP_IDP_AUTHORIZATION_URL',
      'ACTUAL_MCP_IDP_TOKEN_URL',
      'ACTUAL_MCP_IDP_CLIENT_ID',
      'ACTUAL_MCP_IDP_CLIENT_SECRET_FILE',
      'ACTUAL_MCP_ALLOWED_ACCOUNT',
    ]) {
      expect(() => loadRemoteConfig(env({ [name]: undefined }))).toThrow(
        new RegExp(`${name} is required`),
      );
    }
  });

  it('The provider is configuration', () => {
    const google = loadRemoteConfig(env()).oauth.idp;
    const other = loadRemoteConfig(
      env({
        ACTUAL_MCP_IDP_ISSUER: 'https://idp.other.test',
        ACTUAL_MCP_IDP_AUTHORIZATION_URL: 'https://idp.other.test/authorize',
        ACTUAL_MCP_IDP_TOKEN_URL: 'https://idp.other.test/token',
      }),
    ).oauth.idp;
    expect(google.issuer).toBe('https://accounts.google.com');
    expect(other.tokenUrl).toBe('https://idp.other.test/token');
    // Upstream endpoints must be https.
    expect(() =>
      loadRemoteConfig(
        env({ ACTUAL_MCP_IDP_TOKEN_URL: 'http://idp.other.test/token' }),
      ),
    ).toThrow(/https/);
  });

  it('Defaults: the Claude callback, no dynamic registration', () => {
    const { oauth } = loadRemoteConfig(env());
    expect(oauth.redirectUris).toEqual([
      'https://claude.ai/api/mcp/auth_callback',
    ]);
    expect(oauth.allowDynamicRegistration).toBe(false);
    expect(oauth.stateFile).toMatch(/staging-remote\/oauth-state\.json$/);
    const wider = loadRemoteConfig(
      env({
        ACTUAL_MCP_REDIRECT_URIS:
          'https://claude.ai/api/mcp/auth_callback, https://claude.com/api/mcp/auth_callback',
        ACTUAL_MCP_ALLOW_DYNAMIC_REGISTRATION: '1',
      }),
    ).oauth;
    expect(wider.redirectUris).toHaveLength(2);
    expect(wider.allowDynamicRegistration).toBe(true);
    expect(() =>
      loadRemoteConfig(
        env({ ACTUAL_MCP_REDIRECT_URIS: 'http://evil.example.test/cb' }),
      ),
    ).toThrow(/https/);
  });

  it('Beyond loopback only the public hostname is allowed', () => {
    const open = { ACTUAL_MCP_LISTEN_HOST: '0.0.0.0' };
    expect(loadRemoteConfig(env(open)).allowedHosts).toEqual([
      'mcp-staging.example.test',
    ]);
    for (const hosts of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      '*',
      '*.example.test',
      'mcp-staging.example.test,other.example.test',
    ]) {
      expect(() =>
        loadRemoteConfig(env({ ...open, ACTUAL_MCP_ALLOWED_HOSTS: hosts })),
      ).toThrow(/public hostname/);
    }
    expect(() =>
      loadRemoteConfig(env({ ACTUAL_MCP_ALLOWED_HOSTS: '*' })),
    ).toThrow(/public hostname|wildcard/);
    // Behind a proxy on loopback the public name is accepted alongside the local ones.
    expect(loadRemoteConfig(env()).allowedHosts).toContain(
      'mcp-staging.example.test',
    );
  });
});
