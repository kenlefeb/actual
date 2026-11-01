import { mkdirSync, realpathSync, rmdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, resolve, sep } from 'path';

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

// macOS volumes are case-insensitive by default, so "documents" is "Documents".
const fold = (path: string) =>
  process.platform === 'darwin' ? path.toLowerCase() : path;

function realpathOr(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isRefusedPath(dir: string): boolean {
  const target = fold(dir);
  const homes = new Set([homedir(), realpathOr(homedir())]);
  return (
    SYNCED_PATHS.some(p => target.includes(fold(p))) ||
    HOME_FOLDERS.some(f =>
      [...homes].some(home => {
        const folder = fold(join(home, f));
        return target === folder || target.startsWith(folder + sep);
      }),
    )
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
  /** `--writes`: register the write tools (never for production). */
  writes: boolean;
  /** Write audit log, beside the data directory: `<dataDir>.audit.jsonl`. */
  auditLog: string;
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
  // The writes entry has its own copy, so a write that ends before it syncs
  // never sits in the copy a read entry opens and syncs.
  const writes = argv.includes('--writes');
  const dataDir = resolve(
    env.ACTUAL_DATA_DIR ||
      join(
        homedir(),
        'Library',
        'Application Support',
        'actual-mcp',
        writes ? `${label}-writes` : label,
      ),
  );

  return {
    serverUrl,
    password,
    syncId,
    encryptionPassword,
    env: label,
    dataDir,
    writes,
    auditLog: `${dataDir}.audit.jsonl`,
    secrets: [password, encryptionPassword].filter((s): s is string =>
      Boolean(s),
    ),
  };
}

/**
 * Creates the data directory (it holds plaintext budget data) with mode 0700,
 * and refuses one that is looser, not owned by this user, or inside a synced
 * or vault location. The location is checked before anything is created, so a
 * refused start leaves nothing behind: the nearest existing ancestor's real
 * path (symlinks followed) plus the missing segments is what gets checked.
 */
export function ensurePrivateDir(dir: string) {
  const refuse = () => {
    throw new Error('The data directory must not be in a synced location.');
  };
  const given = resolve(dir);
  let ancestor = given;
  const missing: string[] = [];
  let real: string;
  for (;;) {
    try {
      real = realpathSync(ancestor);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = dirname(ancestor);
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || parent === ancestor) {
        throw error;
      }
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
  if (isRefusedPath(given) || isRefusedPath(join(real, ...missing))) refuse();

  // Create one segment at a time, so we know exactly what this call made.
  const created: string[] = [];
  let at = real;
  try {
    for (const segment of missing) {
      at = join(at, segment);
      mkdirSync(at, { mode: 0o700 });
      created.push(at);
    }
    // A symlink could have been put in place after the check above.
    if (missing.length > 0 && isRefusedPath(realpathSync(given))) refuse();
  } catch (error) {
    // Non-recursive and deepest first: only empty directories we made go.
    for (const path of created.reverse()) {
      try {
        rmdirSync(path);
      } catch {
        // best effort
      }
    }
    throw error;
  }
  if (isRefusedPath(realpathSync(given))) refuse();
  const info = statSync(given);
  if (info.uid !== process.getuid?.()) {
    throw new Error('The data directory must be owned by you.');
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error('The data directory must have mode 0700.');
  }
}
