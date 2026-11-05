import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join } from 'path';

import { ensurePrivateDir, loadConfig } from './config';

const base = {
  ACTUAL_PASSWORD: 'hunter2-secret',
  ACTUAL_SYNC_ID: 'sync-1',
};

describe('allowlist', () => {
  it.each([
    ['http://localhost:5006', 'local'],
    ['http://127.0.0.1:5006', 'local'],
    ['http://[::1]:5006', 'local'],
    ['https://actual-staging.owl-becrux.ts.net', 'staging'],
  ])('labels %s as %s', (url, label) => {
    const config = loadConfig({ ...base, ACTUAL_SERVER_URL: url });
    expect(config.env).toBe(label);
    expect(config.dataDir).toMatch(new RegExp(`actual-mcp/${label}$`));
  });

  it('Production is refused by default', () => {
    expect(() =>
      loadConfig({ ...base, ACTUAL_SERVER_URL: 'https://actual.example.com' }),
    ).toThrow(/Refusing to connect to actual\.example\.com/);
  });

  it('A look-alike host', () => {
    for (const url of [
      'https://actual-staging.owl-becrux.ts.net.evil.example',
      'https://localhost.evil.com',
    ]) {
      expect(() => loadConfig({ ...base, ACTUAL_SERVER_URL: url })).toThrow(
        /Refusing/,
      );
      expect(
        loadConfig(
          { ...base, ACTUAL_SERVER_URL: url, ACTUAL_MCP_ALLOW_PRODUCTION: '1' },
          [],
        ).env,
      ).toBe('production');
    }
  });

  it('allows production only with ACTUAL_MCP_ALLOW_PRODUCTION=1', () => {
    const env = { ...base, ACTUAL_SERVER_URL: 'https://actual.example.com' };
    expect(() =>
      loadConfig({ ...env, ACTUAL_MCP_ALLOW_PRODUCTION: 'true' }),
    ).toThrow();
    expect(loadConfig({ ...env, ACTUAL_MCP_ALLOW_PRODUCTION: '1' }).env).toBe(
      'production',
    );
  });

  it('Production allows writes when allowed', () => {
    const config = loadConfig(
      {
        ...base,
        ACTUAL_SERVER_URL: 'https://actual.example.com',
        ACTUAL_MCP_ALLOW_PRODUCTION: '1',
      },
      ['--writes'],
    );
    expect(config.writes).toBe(true);
    expect(config.dataDir).toMatch(/production-writes$/);
  });

  it('never puts a password in the refusal message', () => {
    expect(() =>
      loadConfig({
        ...base,
        ACTUAL_SERVER_URL: 'https://user:hunter2-secret@actual.example.com',
      }),
    ).toThrow(expect.not.stringContaining('hunter2-secret'));
  });

  it('rejects non-http URLs', () => {
    expect(() =>
      loadConfig({ ...base, ACTUAL_SERVER_URL: 'file:///etc/passwd' }),
    ).toThrow(/http\(s\)/);
  });
});

describe('credentials', () => {
  it('reads the four variables and collects secrets', () => {
    expect(() => loadConfig({})).toThrow(/ACTUAL_SERVER_URL is required/);
    expect(() => loadConfig({ ACTUAL_SERVER_URL: 'http://localhost' })).toThrow(
      /ACTUAL_PASSWORD is required/,
    );
    const config = loadConfig({
      ...base,
      ACTUAL_SERVER_URL: 'http://localhost',
      ACTUAL_ENCRYPTION_PASSWORD: 'enc-key',
    });
    expect(config.secrets).toEqual(['hunter2-secret', 'enc-key']);
  });

  it('A secret on argv', () => {
    let message = '';
    try {
      loadConfig({ ...base, ACTUAL_SERVER_URL: 'http://localhost' }, [
        '--password',
        'hunter2',
      ]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^Usage: actual-mcp/);
    expect(message).not.toContain('hunter2');
  });
});

describe('data directory', () => {
  it('Directory mode', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'actual-mcp-')), 'a', 'b');
    ensurePrivateDir(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('A loose directory', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'actual-mcp-')), 'loose');
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    expect(() => ensurePrivateDir(dir)).toThrow(/mode 0700/);
  });

  it('refuses a synced location', () => {
    expect(() => ensurePrivateDir('/Users/x/Dropbox/actual-mcp')).toThrow(
      /synced location/,
    );
  });

  it('refuses CloudStorage, Documents and Desktop', () => {
    for (const dir of [
      join(homedir(), 'Library', 'CloudStorage', 'OneDrive', 'actual-mcp'),
      join(homedir(), 'Documents', 'actual-mcp'),
      join(homedir(), 'Desktop'),
    ]) {
      expect(() => ensurePrivateDir(dir)).toThrow(/synced location/);
    }
  });

  it('checks the real path behind a symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'actual-mcp-'));
    const real = join(root, 'Dropbox', 'real');
    mkdirSync(real, { recursive: true, mode: 0o700 });
    const link = join(root, 'innocent');
    symlinkSync(real, link);
    expect(() => ensurePrivateDir(link)).toThrow(/synced location/);
  });
});

describe('data directory is checked before it is created', () => {
  /** Runs `fn` with HOME pointing at a fresh temporary home. */
  function withHome(fn: (home: string) => void) {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'actual-mcp-home-')));
    const saved = process.env.HOME;
    process.env.HOME = home;
    try {
      fn(home);
    } finally {
      process.env.HOME = saved;
    }
  }

  it('A refused directory is not created', () => {
    withHome(home => {
      const dir = join(home, 'Documents', 'actual-mcp', 'staging');
      expect(() => ensurePrivateDir(dir)).toThrow(/synced location/);
      expect(existsSync(join(home, 'Documents'))).toBe(false);
    });
  });

  it('A symlinked parent is checked', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'actual-mcp-')));
    const real = join(root, 'Dropbox', 'real');
    mkdirSync(real, { recursive: true, mode: 0o700 });
    const link = join(root, 'innocent');
    symlinkSync(real, link);
    expect(() => ensurePrivateDir(join(link, 'a', 'b'))).toThrow(
      /synced location/,
    );
    expect(readdirSync(real)).toEqual([]);
  });

  it('An allowed directory is created private', () => {
    withHome(home => {
      const dir = join(
        home,
        'Library',
        'Application Support',
        'actual-mcp',
        'x',
      );
      ensurePrivateDir(dir);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(dirname(dir)).mode & 0o777).toBe(0o700);
    });
  });

  it('A refused directory is matched case-insensitively on macOS', () => {
    if (process.platform !== 'darwin') return;
    withHome(home => {
      expect(() =>
        ensurePrivateDir(join(home, 'documents', 'actual-mcp')),
      ).toThrow(/synced location/);
      expect(() =>
        ensurePrivateDir(join(home, 'dropbox', 'actual-mcp')),
      ).toThrow(/synced location/);
      expect(existsSync(join(home, 'documents'))).toBe(false);
    });
  });

  it('An existing directory owned by someone else is refused', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'actual-mcp-')), 'owned');
    mkdirSync(dir, { mode: 0o700 });
    vi.spyOn(process, 'getuid').mockReturnValue(statSync(dir).uid + 1);
    expect(() => ensurePrivateDir(dir)).toThrow(/owned by you/);
  });
});

describe('the writes entry has its own data directory', () => {
  const staging = {
    ...base,
    ACTUAL_SERVER_URL: 'https://actual-staging.owl-becrux.ts.net',
  };

  it('The entries use separate data directories', () => {
    const read = loadConfig(staging);
    const write = loadConfig(staging, ['--writes']);
    expect(read.dataDir).toMatch(/actual-mcp\/staging$/);
    expect(write.dataDir).toMatch(/actual-mcp\/staging-writes$/);
    expect(write.auditLog).toMatch(/actual-mcp\/staging-writes\.audit\.jsonl$/);
    expect(read.auditLog).toMatch(/actual-mcp\/staging\.audit\.jsonl$/);
  });

  it("A write session's unsent message stays out of a read session", () => {
    // No path is shared, so a write session's copy (and anything it has not
    // sent) is never the copy a read entry opens and syncs.
    for (const url of [
      'http://localhost:5006',
      'https://actual-staging.owl-becrux.ts.net',
    ]) {
      const read = loadConfig({ ...base, ACTUAL_SERVER_URL: url });
      const write = loadConfig({ ...base, ACTUAL_SERVER_URL: url }, [
        '--writes',
      ]);
      expect(write.dataDir).not.toBe(read.dataDir);
      expect(write.dataDir.startsWith(`${read.dataDir}/`)).toBe(false);
      expect(write.auditLog).not.toBe(read.auditLog);
    }
  });

  it('An explicit data directory is never shared with the read entry', () => {
    const env = { ...staging, ACTUAL_DATA_DIR: '/tmp/x/y' };
    const read = loadConfig(env);
    const write = loadConfig(env, ['--writes']);
    expect(read.dataDir).toBe('/tmp/x/y');
    expect(read.auditLog).toBe('/tmp/x/y.audit.jsonl');
    expect(write.dataDir).toBe('/tmp/x/y-writes');
    expect(write.auditLog).toBe('/tmp/x/y-writes.audit.jsonl');
  });
});
