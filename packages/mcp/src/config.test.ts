import { mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ensurePrivateDir, loadConfig } from './config';

const base = {
  ACTUAL_MCP_PASSWORD: 'hunter2-secret',
  ACTUAL_MCP_SYNC_ID: 'sync-1',
};

describe('loadConfig production guard', () => {
  it.each([
    'http://localhost:5006',
    'http://127.0.0.1:5006',
    'http://[::1]:5006',
    'https://actual-staging.owl-becrux.ts.net',
  ])('allows %s', url => {
    expect(loadConfig({ ...base, ACTUAL_MCP_SERVER_URL: url }).serverUrl).toBe(
      url,
    );
  });

  it('refuses any other host by default', () => {
    expect(() =>
      loadConfig({
        ...base,
        ACTUAL_MCP_SERVER_URL: 'https://actual.example.com',
      }),
    ).toThrow(/Refusing to connect to actual\.example\.com/);
  });

  it('does not match look-alike hosts', () => {
    expect(() =>
      loadConfig({
        ...base,
        ACTUAL_MCP_SERVER_URL:
          'https://actual-staging.owl-becrux.ts.net.evil.com',
      }),
    ).toThrow(/Refusing/);
    expect(() =>
      loadConfig({
        ...base,
        ACTUAL_MCP_SERVER_URL: 'https://localhost.evil.com',
      }),
    ).toThrow(/Refusing/);
  });

  it('allows production only with ACTUAL_MCP_ALLOW_PRODUCTION=1', () => {
    const env = {
      ...base,
      ACTUAL_MCP_SERVER_URL: 'https://actual.example.com',
    };
    expect(() =>
      loadConfig({ ...env, ACTUAL_MCP_ALLOW_PRODUCTION: 'true' }),
    ).toThrow();
    expect(
      loadConfig({ ...env, ACTUAL_MCP_ALLOW_PRODUCTION: '1' }).dataDir,
    ).toMatch(/actual-mcp\/production$/);
  });

  it('honors an explicit allowlist', () => {
    const config = loadConfig({
      ...base,
      ACTUAL_MCP_SERVER_URL: 'https://budget.lan',
      ACTUAL_MCP_ALLOWED_HOSTS: 'other.lan, Budget.LAN',
    });
    expect(config.dataDir).toMatch(/actual-mcp\/staging$/);
  });

  it('never puts the password in the refusal message', () => {
    expect(() =>
      loadConfig({
        ...base,
        ACTUAL_MCP_SERVER_URL: 'https://user:hunter2-secret@actual.example.com',
      }),
    ).toThrow(expect.not.stringContaining('hunter2-secret'));
  });

  it('requires url, password and sync id, and collects secrets', () => {
    expect(() => loadConfig({})).toThrow(/ACTUAL_MCP_SERVER_URL is required/);
    expect(() =>
      loadConfig({ ACTUAL_MCP_SERVER_URL: 'http://localhost' }),
    ).toThrow(/ACTUAL_MCP_PASSWORD is required/);
    const config = loadConfig({
      ...base,
      ACTUAL_MCP_SERVER_URL: 'http://localhost',
      ACTUAL_MCP_ENCRYPTION_PASSWORD: 'enc-key',
    });
    expect(config.secrets).toEqual(['hunter2-secret', 'enc-key']);
  });

  it('rejects non-http URLs', () => {
    expect(() =>
      loadConfig({ ...base, ACTUAL_MCP_SERVER_URL: 'file:///etc/passwd' }),
    ).toThrow(/http\(s\)/);
  });
});

describe('ensurePrivateDir', () => {
  it('creates a 0700 directory', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'actual-mcp-')), 'a', 'b');
    ensurePrivateDir(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});
