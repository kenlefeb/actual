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

const env = (extra: Record<string, string> = {}) => ({
  ACTUAL_SERVER_URL: 'https://actual-staging.owl-becrux.ts.net',
  ACTUAL_SYNC_ID: 'sync-1',
  ACTUAL_PASSWORD_FILE: secretFile('hunter2-secret'),
  ...extra,
});

describe('hosted entry configuration', () => {
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
    expect(config.secrets).toEqual(['hunter2-secret', 'enc-key']);
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
