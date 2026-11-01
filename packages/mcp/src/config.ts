import { mkdirSync, realpathSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, sep } from 'path';

// Staging lives on the tailnet; see actual-hosting (compose.tailnet.yaml).
const STAGING_HOST = 'actual-staging.owl-becrux.ts.net';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
// Synced or vault locations that must never hold the plaintext budget.
const SYNCED_PATHS = [
  'Mobile Documents',
  'Dropbox',
  'Obsidian',
  join('Library', 'CloudStorage'),
];
// Folders that sync or are commonly shared; refused under the home directory.
const HOME_FOLDERS = ['Documents', 'Desktop'];

function isRefusedPath(dir: string): boolean {
  const home = homedir();
  return (
    SYNCED_PATHS.some(p => dir.includes(p)) ||
    HOME_FOLDERS.some(f => {
      const folder = join(home, f);
      return dir === folder || dir.startsWith(folder + sep);
    })
  );
}

export type EnvLabel = 'local' | 'staging' | 'production';

export type McpConfig = {
  serverUrl: string;
  password: string;
  syncId: string;
  encryptionPassword?: string;
  dataDir: string;
  env: EnvLabel;
  /** Every secret the server holds, for scrubbing. */
  secrets: string[];
};

type Env = Record<string, string | undefined>;

export function labelHost(serverUrl: string): { host: string; env: EnvLabel } {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new Error('ACTUAL_SERVER_URL is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ACTUAL_SERVER_URL must be an http(s) URL.');
  }
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.includes(host)) return { host, env: 'local' };
  if (host === STAGING_HOST) return { host, env: 'staging' };
  return { host, env: 'production' };
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/**
 * Reads config from the environment only. Secrets are never accepted on
 * argv: the only flag is `--writes`, and anything else is a fixed usage error.
 */
export function loadConfig(env: Env, argv: string[] = []): McpConfig {
  const unknown = argv.filter(a => a !== '--writes');
  if (unknown.length > 0) {
    throw new Error(
      'Usage: actual-mcp [--writes]. Credentials are read from the environment, never from arguments.',
    );
  }

  const serverUrl = required(env, 'ACTUAL_SERVER_URL');
  const password = required(env, 'ACTUAL_PASSWORD');
  const syncId = required(env, 'ACTUAL_SYNC_ID');
  const encryptionPassword = env.ACTUAL_ENCRYPTION_PASSWORD || undefined;

  const { host, env: label } = labelHost(serverUrl);
  if (label === 'production' && env.ACTUAL_MCP_ALLOW_PRODUCTION !== '1') {
    throw new Error(
      `Refusing to connect to ${host}: it is not localhost or the staging host. ` +
        'Set ACTUAL_MCP_ALLOW_PRODUCTION=1 to allow it (read-only).',
    );
  }
  if (label === 'production' && argv.includes('--writes')) {
    throw new Error('--writes is not allowed for a production host.');
  }
  if (argv.includes('--writes')) {
    throw new Error('Write tools are not available in this version.');
  }

  return {
    serverUrl,
    password,
    syncId,
    encryptionPassword,
    env: label,
    dataDir:
      env.ACTUAL_DATA_DIR ||
      join(homedir(), 'Library', 'Application Support', 'actual-mcp', label),
    secrets: [password, encryptionPassword].filter((s): s is string =>
      Boolean(s),
    ),
  };
}

/**
 * Creates the data directory (it holds plaintext budget data) with mode 0700,
 * and refuses one that is looser or inside a synced or vault location.
 */
export function ensurePrivateDir(dir: string) {
  const refuse = () => {
    throw new Error('The data directory must not be in a synced location.');
  };
  if (isRefusedPath(dir)) refuse();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // A symlink must not smuggle the directory into a refused location.
  if (isRefusedPath(realpathSync(dir))) refuse();
  if ((statSync(dir).mode & 0o077) !== 0) {
    throw new Error('The data directory must have mode 0700.');
  }
}
