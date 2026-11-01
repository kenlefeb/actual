import { readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

import { labelHost } from './config';
import type { McpConfig } from './config';

export type RemoteConfig = McpConfig & {
  /** Where the listener binds; loopback unless an authentication hook is set. */
  listen: { host: string; port: number };
  /** Accepted `Host` header names (without port): the public hostname goes here. */
  allowedHosts: string[];
  /** Browser origins accepted when a request carries `Origin`. */
  allowedOrigins: string[];
  syncIntervalMs: number;
  rate: { perEndpoint: number; perClient: number; windowMs: number };
};

type Env = Record<string, string | undefined>;

const SECRET_FILE_ERROR =
  'A secret file is missing or readable by others (it must be a file only its owner can read).';

/**
 * Reads a secret from a file. The file must exist and be readable by its
 * owner alone; the fixed error never names the path or the content.
 */
function readSecretFile(path: string): string {
  try {
    const info = statSync(path);
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== process.getuid?.()
    ) {
      throw new Error('loose');
    }
    return readFileSync(path, 'utf8').trim();
  } catch {
    throw new Error(SECRET_FILE_ERROR);
  }
}

function list(value: string | undefined, fallback: string[]) {
  const items = (value ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function positiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive whole number.`);
  }
  return n;
}

/**
 * Configuration for the hosted, read-only entry. Secrets come from files
 * only (never argv, and never an environment value); there is no way to turn
 * writes on, and a production host is refused whatever else is set.
 */
export function loadRemoteConfig(env: Env, argv: string[] = []): RemoteConfig {
  if (argv.includes('--writes')) {
    throw new Error(
      'actual-mcp-http is read-only: --writes is not supported on the hosted entry.',
    );
  }
  if (argv.length > 0) {
    throw new Error(
      'Usage: actual-mcp-http. Settings are read from the environment, never from arguments.',
    );
  }

  const serverUrl = env.ACTUAL_SERVER_URL;
  if (!serverUrl) throw new Error('ACTUAL_SERVER_URL is required.');
  const syncId = env.ACTUAL_SYNC_ID;
  if (!syncId) throw new Error('ACTUAL_SYNC_ID is required.');

  const { env: label } = labelHost(serverUrl);
  if (label === 'production') {
    // Not even ACTUAL_MCP_ALLOW_PRODUCTION lifts this: v1 serves staging only.
    throw new Error(
      'The hosted entry serves staging only; it will not start for a production host.',
    );
  }

  if (!env.ACTUAL_PASSWORD_FILE) {
    throw new Error('ACTUAL_PASSWORD_FILE is required.');
  }
  const password = readSecretFile(env.ACTUAL_PASSWORD_FILE);
  const encryptionPassword = env.ACTUAL_ENCRYPTION_PASSWORD_FILE
    ? readSecretFile(env.ACTUAL_ENCRYPTION_PASSWORD_FILE)
    : undefined;
  // The signing key is used by the OAuth slice; a configured file is checked now.
  if (env.ACTUAL_MCP_SIGNING_KEY_FILE) {
    readSecretFile(env.ACTUAL_MCP_SIGNING_KEY_FILE);
  }

  // One budget per instance: its own copy, never the stdio entries'.
  const base = resolve(
    env.ACTUAL_DATA_DIR ||
      join(homedir(), 'Library', 'Application Support', 'actual-mcp', label),
  );

  return {
    serverUrl,
    password,
    syncId,
    encryptionPassword,
    env: label,
    dataDir: `${base}-remote`,
    writes: false,
    auditLog: '',
    secrets: [password, encryptionPassword].filter((s): s is string =>
      Boolean(s),
    ),
    listen: {
      host: env.ACTUAL_MCP_LISTEN_HOST || '127.0.0.1',
      port: positiveInt(
        env.ACTUAL_MCP_LISTEN_PORT,
        8787,
        'ACTUAL_MCP_LISTEN_PORT',
      ),
    },
    allowedHosts: list(env.ACTUAL_MCP_ALLOWED_HOSTS, [
      'localhost',
      '127.0.0.1',
      '[::1]',
    ]),
    allowedOrigins: list(env.ACTUAL_MCP_ALLOWED_ORIGINS, []),
    syncIntervalMs:
      positiveInt(
        env.ACTUAL_MCP_SYNC_INTERVAL_SECONDS,
        300,
        'ACTUAL_MCP_SYNC_INTERVAL_SECONDS',
      ) * 1000,
    rate: {
      perEndpoint: positiveInt(
        env.ACTUAL_MCP_RATE_PER_ENDPOINT,
        120,
        'ACTUAL_MCP_RATE_PER_ENDPOINT',
      ),
      perClient: positiveInt(
        env.ACTUAL_MCP_RATE_PER_CLIENT,
        60,
        'ACTUAL_MCP_RATE_PER_CLIENT',
      ),
      windowMs: 60_000,
    },
  };
}
