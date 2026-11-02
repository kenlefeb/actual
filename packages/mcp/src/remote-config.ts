import { readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

import { labelHost } from './config';
import type { McpConfig } from './config';
import type { OAuthConfig } from './oauth';

export type RemoteConfig = McpConfig & {
  /** Where the listener binds; loopback unless an authentication hook is set. */
  listen: { host: string; port: number };
  /** Accepted `Host` header names (without port): the public hostname goes here. */
  allowedHosts: string[];
  /** Browser origins accepted when a request carries `Origin`. */
  allowedOrigins: string[];
  syncIntervalMs: number;
  rate: { perEndpoint: number; perClient: number; windowMs: number };
  /** Required: the hosted entry never serves without its authorization server. */
  oauth: OAuthConfig;
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

const MIN_SIGNING_KEY_LENGTH = 32;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];
const DEFAULT_REDIRECTS = ['https://claude.ai/api/mcp/auth_callback'];

function required(env: Env, name: string) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function httpsUrl(value: string, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${name} must be an https URL.`);
  }
  return url;
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
  // The signing key is required: with no key (or a loose or short one) the
  // entry refuses to start, and there is no unauthenticated fallback.
  const signingKey = readSecretFile(
    required(env, 'ACTUAL_MCP_SIGNING_KEY_FILE'),
  );
  if (signingKey.length < MIN_SIGNING_KEY_LENGTH) {
    throw new Error(
      `The signing key must be at least ${MIN_SIGNING_KEY_LENGTH} characters.`,
    );
  }
  const clientSecret = readSecretFile(
    required(env, 'ACTUAL_MCP_CLIENT_SECRET_FILE'),
  );
  const idpSecret = readSecretFile(
    required(env, 'ACTUAL_MCP_IDP_CLIENT_SECRET_FILE'),
  );
  // The public URL is an origin: the issuer and resource are built from it.
  const publicUrl = httpsUrl(
    required(env, 'ACTUAL_MCP_PUBLIC_URL'),
    'ACTUAL_MCP_PUBLIC_URL',
  );
  const publicHost = publicUrl.hostname.toLowerCase();
  const redirectUris = (env.ACTUAL_MCP_REDIRECT_URIS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  for (const uri of redirectUris) httpsUrl(uri, 'ACTUAL_MCP_REDIRECT_URIS');
  const idpAuth = required(env, 'ACTUAL_MCP_IDP_AUTHORIZATION_URL');
  const idpToken = required(env, 'ACTUAL_MCP_IDP_TOKEN_URL');
  const idpIssuer = required(env, 'ACTUAL_MCP_IDP_ISSUER');
  for (const [value, name] of [
    [idpAuth, 'ACTUAL_MCP_IDP_AUTHORIZATION_URL'],
    [idpToken, 'ACTUAL_MCP_IDP_TOKEN_URL'],
    [idpIssuer, 'ACTUAL_MCP_IDP_ISSUER'],
  ] as const) {
    httpsUrl(value, name);
  }

  const listenHost = env.ACTUAL_MCP_LISTEN_HOST || '127.0.0.1';
  const explicitHosts = list(env.ACTUAL_MCP_ALLOWED_HOSTS, []);
  const onlyPublic = explicitHosts.every(h => h === publicHost);
  // Beyond loopback, and whenever a wildcard is asked for, only the public
  // hostname may be allowed: no loopback names and no patterns.
  if (
    explicitHosts.some(h => h.includes('*')) ||
    (!LOOPBACK_HOSTS.includes(listenHost) && !onlyPublic)
  ) {
    throw new Error(
      'ACTUAL_MCP_ALLOWED_HOSTS may name only the public hostname beyond loopback, with no wildcard.',
    );
  }
  const allowedHosts = !LOOPBACK_HOSTS.includes(listenHost)
    ? [publicHost]
    : explicitHosts.length > 0
      ? explicitHosts
      : ['localhost', '127.0.0.1', '[::1]', publicHost];

  // One budget per instance: its own copy, never the stdio entries'.
  const base = resolve(
    env.ACTUAL_DATA_DIR ||
      join(homedir(), 'Library', 'Application Support', 'actual-mcp', label),
  );

  const dataDir = `${base}-remote`;

  return {
    serverUrl,
    password,
    syncId,
    encryptionPassword,
    env: label,
    dataDir,
    writes: false,
    auditLog: '',
    secrets: [
      password,
      encryptionPassword,
      signingKey,
      clientSecret,
      idpSecret,
    ].filter((s): s is string => Boolean(s)),
    listen: {
      host: listenHost,
      port: positiveInt(
        env.ACTUAL_MCP_LISTEN_PORT,
        8787,
        'ACTUAL_MCP_LISTEN_PORT',
      ),
    },
    allowedHosts,
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
    oauth: {
      publicUrl: publicUrl.origin,
      signingKey,
      clientId: required(env, 'ACTUAL_MCP_CLIENT_ID'),
      clientSecret,
      redirectUris: redirectUris.length > 0 ? redirectUris : DEFAULT_REDIRECTS,
      allowDynamicRegistration:
        env.ACTUAL_MCP_ALLOW_DYNAMIC_REGISTRATION === '1',
      stateFile: join(dataDir, 'oauth-state.json'),
      idp: {
        issuer: idpIssuer,
        authorizationUrl: idpAuth,
        tokenUrl: idpToken,
        clientId: required(env, 'ACTUAL_MCP_IDP_CLIENT_ID'),
        clientSecret: idpSecret,
        account: required(env, 'ACTUAL_MCP_ALLOWED_ACCOUNT'),
      },
    },
  };
}
