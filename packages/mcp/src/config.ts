import { chmodSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Staging lives on the tailnet; see actual-hosting (compose.tailnet.yaml).
const STAGING_HOST = 'actual-staging.owl-becrux.ts.net';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export type McpConfig = {
  serverUrl: string;
  password: string;
  syncId: string;
  encryptionPassword?: string;
  dataDir: string;
  /** Every secret the server holds, for scrubbing. */
  secrets: string[];
};

type Env = Record<string, string | undefined>;

export function classifyHost(
  serverUrl: string,
  extraAllowed: string[] = [],
): { host: string; env: 'local' | 'staging' | 'production' } {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new Error('ACTUAL_MCP_SERVER_URL is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ACTUAL_MCP_SERVER_URL must be an http(s) URL.');
  }
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.includes(host)) return { host, env: 'local' };
  if (host === STAGING_HOST || extraAllowed.includes(host)) {
    return { host, env: 'staging' };
  }
  return { host, env: 'production' };
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/** Reads config from environment variables only; never from argv or files. */
export function loadConfig(env: Env): McpConfig {
  const serverUrl = required(env, 'ACTUAL_MCP_SERVER_URL');
  const password = required(env, 'ACTUAL_MCP_PASSWORD');
  const syncId = required(env, 'ACTUAL_MCP_SYNC_ID');
  const encryptionPassword = env.ACTUAL_MCP_ENCRYPTION_PASSWORD || undefined;

  const extraAllowed = (env.ACTUAL_MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
  const { host, env: target } = classifyHost(serverUrl, extraAllowed);
  if (target === 'production' && env.ACTUAL_MCP_ALLOW_PRODUCTION !== '1') {
    throw new Error(
      `Refusing to connect to ${host}: it is not localhost or a known staging host. ` +
        'Set ACTUAL_MCP_ALLOW_PRODUCTION=1 to allow it (read-only).',
    );
  }

  const dataDir =
    env.ACTUAL_MCP_DATA_DIR ||
    join(homedir(), 'Library', 'Application Support', 'actual-mcp', target);

  return {
    serverUrl,
    password,
    syncId,
    encryptionPassword,
    dataDir,
    secrets: [password, encryptionPassword].filter((s): s is string =>
      Boolean(s),
    ),
  };
}

/** Creates the data directory private to the current user (it holds plaintext budget data). */
export function ensurePrivateDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}
