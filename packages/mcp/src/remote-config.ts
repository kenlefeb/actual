import { homedir } from 'os';
import { basename, join, resolve } from 'path';

import { labelHost, readSecretFile, resolveCredential } from './config';
import type { McpConfig } from './config';
import { isLoopbackUri } from './oauth';
import type { OAuthConfig } from './oauth';

export type RemoteConfig = McpConfig & {
  /** Where the listener binds; loopback unless an authentication hook is set. */
  listen: { host: string; port: number };
  /** Accepted `Host` header names (without port): the public hostname goes here. */
  allowedHosts: string[];
  /** Browser origins accepted when a request carries `Origin`. */
  allowedOrigins: string[];
  syncIntervalMs: number;
  rate: {
    perEndpoint: number;
    perPrefix: number;
    perClient: number;
    windowMs: number;
  };
  /** Required: the hosted entry never serves without its authorization server. */
  oauth: OAuthConfig;
  /** True when the production guard was met; the entry then validates the token at start. */
  production?: boolean;
};

type Env = Record<string, string | undefined>;

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
 * writes on, and a production host needs the explicit production guard.
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
  const production = label === 'production';
  if (production) {
    // The stdio override ACTUAL_MCP_ALLOW_PRODUCTION never counts here.
    if (env.ACTUAL_MCP_REMOTE_PRODUCTION !== '1') {
      throw new Error(
        'The hosted entry serves a production host only with ACTUAL_MCP_REMOTE_PRODUCTION=1.',
      );
    }
    if (env.ACTUAL_PASSWORD_FILE || !env.ACTUAL_SESSION_TOKEN_FILE) {
      throw new Error(
        'Production needs a session token file (ACTUAL_SESSION_TOKEN_FILE) and no password.',
      );
    }
    if ((env.ACTUAL_MCP_ALLOWED_ACCOUNT ?? '').includes('@')) {
      throw new Error(
        'Production needs the allowed account as a provider subject identifier, not an email address.',
      );
    }
  }

  const { password, sessionToken } = resolveCredential(
    env,
    env.ACTUAL_PASSWORD_FILE
      ? readSecretFile(env.ACTUAL_PASSWORD_FILE)
      : undefined,
    'ACTUAL_PASSWORD_FILE',
  );
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
  if (clientSecret.length < MIN_SIGNING_KEY_LENGTH) {
    throw new Error(
      `The client secret must be at least ${MIN_SIGNING_KEY_LENGTH} characters.`,
    );
  }
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
  for (const uri of redirectUris) {
    httpsUrl(uri, 'ACTUAL_MCP_REDIRECT_URIS');
    if (isLoopbackUri(uri)) {
      throw new Error(
        'ACTUAL_MCP_REDIRECT_URIS may not name a loopback address.',
      );
    }
  }
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
  if (production && basename(dataDir) !== 'production-remote') {
    throw new Error('Production needs the data directory production-remote.');
  }
  // A loopback server is labelled local; with a public listener it could be a
  // forward to a production server that skips the production checks.
  if (label === 'local' && !LOOPBACK_HOSTS.includes(listenHost)) {
    throw new Error(
      'A loopback server needs a loopback listener on the hosted entry.',
    );
  }

  return {
    serverUrl,
    password,
    sessionToken,
    syncId,
    encryptionPassword,
    env: label,
    dataDir,
    writes: false,
    production,
    auditLog: '',
    secrets: [
      password,
      sessionToken,
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
      // Over every source in one /24 (IPv4) or /48 (IPv6), five times the
      // per-source limit: one person's sign-in is a handful of requests.
      perPrefix: positiveInt(
        env.ACTUAL_MCP_RATE_PER_PREFIX,
        600,
        'ACTUAL_MCP_RATE_PER_PREFIX',
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
