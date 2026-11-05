import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { chmodSync, readFileSync, renameSync, writeFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';

import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  TemporarilyUnavailableError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

export type OAuthConfig = {
  /** Public origin of this server, e.g. https://mcp.example.com (no path). */
  publicUrl: string;
  /** Signs access tokens and keys the refresh-token hashes; rotating it kills every token. */
  signingKey: string;
  clientId: string;
  clientSecret: string;
  /** Exact-match redirect allowlist for the pre-registered client. */
  redirectUris: string[];
  allowDynamicRegistration: boolean;
  /** JSON file for refresh-token families; holds only keyed hashes. */
  stateFile: string;
  /** The one upstream identity provider, all configuration. */
  idp: {
    issuer: string;
    authorizationUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    /** The one allowed account: an email address (verified) or the provider's stable subject. */
    account: string;
  };
};

/**
 * The SDK relaxes the port of a loopback redirect URI, which would make the
 * allowlist less than exact; so no loopback redirect is ever allowed.
 */
export function isLoopbackUri(uri: string) {
  try {
    const host = new URL(uri).hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  } catch {
    return false;
  }
}

const MCP_PATH = '/mcp';
const CALLBACK_PATH = '/oauth/callback';

/** Every path the authorization server answers (the MCP endpoint is separate). */
export const OAUTH_ENDPOINTS = [
  '/authorize',
  '/token',
  '/revoke',
  '/register',
  CALLBACK_PATH,
  '/.well-known/oauth-authorization-server',
  `/.well-known/oauth-protected-resource${MCP_PATH}`,
];

const SCOPE = 'budget:read';
const ACCESS_TTL_S = 15 * 60;
const REFRESH_MAX_S = 30 * 24 * 60 * 60;
const CODE_TTL_MS = 5 * 60_000;
const SIGN_IN_TTL_MS = 10 * 60_000;
const IDP_TIMEOUT_MS = 10_000;
// Unauthenticated callers can start sign-ins and registrations: bound the memory.
const MAX_PENDING = 200;
const MAX_DYNAMIC_CLIENTS = 20;

type Family = {
  id: string;
  clientId: string;
  scopes: string[];
  /** The provider's stable subject for the signed-in account: an id, not a secret. */
  subject: string;
  /** Keyed hash of the current refresh token, and of the one it replaced. */
  hash: string;
  prevHash?: string;
  /** Hard stop in seconds since epoch: 30 days after the sign-in. */
  expiresAt: number;
};

type AccessClaims = {
  f: string;
  c: string;
  s: string[];
  a: string;
  e: number;
  u: string;
};

type SignIn = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  nonce: string;
  idpVerifier: string;
  expiresAt: number;
};

type Code = Omit<SignIn, 'state' | 'nonce' | 'idpVerifier'> & {
  subject: string;
};

export type OAuthServer = {
  publicHost: string;
  resourceMetadataUrl: string;
  /** Answers the paths in OAUTH_ENDPOINTS. */
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  /** Accepts only an Authorization: Bearer token minted here for this resource. */
  authenticate: (
    req: IncomingMessage,
  ) => Promise<{ clientId: string; subject: string } | null>;
};

const b64u = (value: string | Buffer) =>
  Buffer.from(value).toString('base64url');
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('base64url');
const token = (bytes: number) => randomBytes(bytes).toString('base64url');

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Drops expired entries, then refuses a new one when the map is full. */
function admit<T extends { expiresAt: number }>(
  map: Map<string, T>,
  now: number,
) {
  for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key);
  if (map.size >= MAX_PENDING) {
    throw new TemporarilyUnavailableError('Too many pending requests.');
  }
}

function claimsOf(idToken: unknown): Record<string, unknown> | undefined {
  if (typeof idToken !== 'string') return undefined;
  // shortcut: the signature is not verified. The ID token arrives straight
  // from the provider's token endpoint over TLS, which OIDC Core 3.1.3.7
  // accepts in place of a signature check; verify against the provider's
  // keys if a token ever comes from anywhere else.
  try {
    return JSON.parse(
      Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
  } catch {
    return undefined;
  }
}

const normalizeIssuer = (value: unknown) =>
  String(value)
    .replace(/^https:\/\//, '')
    .replace(/\/$/, '');

/**
 * The hosted entry's authorization server: the SDK's router around a provider
 * that signs in exactly one upstream account, serves one pre-registered
 * client, and issues short-lived signed access tokens plus rotating,
 * revocable refresh tokens. Pending sign-ins and codes live in memory only.
 */
export function createOAuthServer(
  config: OAuthConfig,
  options: {
    record: (entry: Record<string, unknown>) => void;
    /** Accepted Host names, passed to the SDK's own host check as well. */
    allowedHosts: string[];
    fetch?: typeof fetch;
    now?: () => number;
  },
): OAuthServer {
  if (config.redirectUris.some(isLoopbackUri)) {
    throw new Error('Redirect URIs may not be loopback addresses.');
  }
  const { record } = options;
  const fetchIdp = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const nowS = () => Math.floor(now() / 1000);

  const publicUrl = new URL(config.publicUrl);
  const resource = new URL(MCP_PATH, publicUrl);
  const callbackUrl = new URL(CALLBACK_PATH, publicUrl).href;
  const sameResource = (value: URL) =>
    value.href.replace(/\/$/, '') === resource.href;

  const mac = (label: string, value: string) =>
    createHmac('sha256', config.signingKey)
      .update(`${label}.${value}`)
      .digest('base64url');

  // Refresh-token families, on disk as keyed hashes only.
  const families = new Map<string, Family>();
  try {
    const saved = JSON.parse(readFileSync(config.stateFile, 'utf8'));
    for (const f of Array.isArray(saved?.families) ? saved.families : []) {
      if (
        typeof f?.id === 'string' &&
        typeof f?.hash === 'string' &&
        typeof f?.subject === 'string'
      ) {
        families.set(f.id, f);
      }
    }
  } catch {
    // No state yet (or an unreadable file): nothing is signed in.
  }
  function save() {
    for (const [id, f] of families) {
      if (f.expiresAt <= nowS()) families.delete(id);
    }
    const temp = `${config.stateFile}.tmp`;
    writeFileSync(temp, JSON.stringify({ families: [...families.values()] }), {
      mode: 0o600,
    });
    chmodSync(temp, 0o600);
    renameSync(temp, config.stateFile);
  }
  const findFamily = (refreshToken: string) => {
    const hash = mac('refresh', refreshToken);
    for (const family of families.values()) {
      if (family.hash === hash) return { family, replayed: false };
      if (family.prevHash === hash) return { family, replayed: true };
    }
    return undefined;
  };

  function readAccess(value: string): AccessClaims | undefined {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined) return undefined;
    if (!safeEqual(signature, mac('access', payload))) return undefined;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return typeof claims?.f === 'string' &&
        typeof claims.c === 'string' &&
        typeof claims.a === 'string' &&
        typeof claims.e === 'number' &&
        typeof claims.u === 'string' &&
        Array.isArray(claims.s)
        ? claims
        : undefined;
    } catch {
      return undefined;
    }
  }

  function issue(family: Family): OAuthTokens {
    const refresh = token(32);
    family.prevHash = family.hash || undefined;
    family.hash = mac('refresh', refresh);
    families.set(family.id, family);
    save();
    const expires = Math.min(nowS() + ACCESS_TTL_S, family.expiresAt);
    const payload = b64u(
      JSON.stringify({
        f: family.id,
        u: family.subject,
        c: family.clientId,
        s: family.scopes,
        a: resource.href,
        e: expires,
      } satisfies AccessClaims),
    );
    return {
      access_token: `${payload}.${mac('access', payload)}`,
      token_type: 'Bearer',
      expires_in: expires - nowS(),
      scope: family.scopes.join(' '),
      refresh_token: refresh,
    };
  }

  const signIns = new Map<string, SignIn>();
  const codes = new Map<string, Code>();

  const registered: OAuthClientInformationFull = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: config.redirectUris,
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: SCOPE,
    client_name: 'Claude',
  };
  // Dynamic clients exist only while the switch is on, and only in memory.
  const dynamic = new Map<string, OAuthClientInformationFull>();

  const provider: OAuthServerProvider = {
    clientsStore: {
      getClient: id => (id === config.clientId ? registered : dynamic.get(id)),
      ...(config.allowDynamicRegistration
        ? {
            registerClient: (client: OAuthClientInformationFull) => {
              const allowed = client.redirect_uris.every(
                uri =>
                  !isLoopbackUri(String(uri)) &&
                  config.redirectUris.includes(String(uri)),
              );
              if (!allowed || dynamic.size >= MAX_DYNAMIC_CLIENTS) {
                throw new InvalidClientMetadataError(
                  'redirect_uris must all be on the allowlist.',
                );
              }
              dynamic.set(client.client_id, client);
              return client;
            },
          }
        : {}),
    },

    async authorize(client, params, res) {
      if (params.resource && !sameResource(params.resource)) {
        throw new InvalidTargetError('Unknown resource.');
      }
      const scopes = params.scopes?.length ? params.scopes : [SCOPE];
      if (scopes.some(s => s !== SCOPE)) {
        throw new InvalidScopeError('Unsupported scope.');
      }
      admit(signIns, now());
      const state = token(24);
      const entry: SignIn = {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        scopes,
        nonce: token(16),
        idpVerifier: token(32),
        expiresAt: now() + SIGN_IN_TTL_MS,
      };
      signIns.set(state, entry);
      const url = new URL(config.idp.authorizationUrl);
      for (const [key, value] of Object.entries({
        response_type: 'code',
        client_id: config.idp.clientId,
        redirect_uri: callbackUrl,
        scope: 'openid email',
        state,
        nonce: entry.nonce,
        code_challenge: sha256(entry.idpVerifier),
        code_challenge_method: 'S256',
      })) {
        url.searchParams.set(key, value);
      }
      res.redirect(302, url.href);
    },

    async challengeForAuthorizationCode(client, code) {
      const entry = codes.get(code);
      if (
        !entry ||
        entry.expiresAt <= now() ||
        entry.clientId !== client.client_id
      ) {
        throw new InvalidGrantError('Invalid authorization code.');
      }
      return entry.codeChallenge;
    },

    async exchangeAuthorizationCode(
      client,
      code,
      _verifier,
      redirectUri,
      target,
    ) {
      const entry = codes.get(code);
      codes.delete(code); // single use, whatever happens next
      if (
        !entry ||
        entry.expiresAt <= now() ||
        entry.clientId !== client.client_id ||
        (redirectUri !== undefined && redirectUri !== entry.redirectUri)
      ) {
        throw new InvalidGrantError('Invalid authorization code.');
      }
      if (target && !sameResource(target)) {
        throw new InvalidTargetError('Unknown resource.');
      }
      const tokens = issue({
        id: token(16),
        subject: entry.subject,
        clientId: client.client_id,
        scopes: entry.scopes,
        hash: '',
        expiresAt: nowS() + REFRESH_MAX_S,
      });
      record({ event: 'token_issue', client: client.client_id });
      return tokens;
    },

    async exchangeRefreshToken(client, refreshToken, scopes, target) {
      const found = findFamily(refreshToken);
      if (found?.replayed) {
        // An old token coming back means a copy leaked: end the whole family.
        families.delete(found.family.id);
        save();
        record({
          event: 'refused',
          reason: 'refresh-replay',
          client: client.client_id,
        });
      }
      const family = found && !found.replayed ? found.family : undefined;
      if (
        !family ||
        family.clientId !== client.client_id ||
        family.expiresAt <= nowS()
      ) {
        throw new InvalidGrantError('Invalid refresh token.');
      }
      if (scopes?.some(s => !family.scopes.includes(s))) {
        throw new InvalidScopeError('Unsupported scope.');
      }
      if (target && !sameResource(target)) {
        throw new InvalidTargetError('Unknown resource.');
      }
      const tokens = issue(family);
      record({ event: 'token_refresh', client: client.client_id });
      return tokens;
    },

    async verifyAccessToken(value): Promise<AuthInfo> {
      const claims = readAccess(value);
      const family = claims && families.get(claims.f);
      if (
        !claims ||
        !family ||
        claims.e <= nowS() ||
        family.expiresAt <= nowS()
      ) {
        throw new InvalidTokenError('Invalid access token.');
      }
      return {
        token: value,
        clientId: claims.c,
        scopes: claims.s,
        extra: { subject: claims.u },
        expiresAt: claims.e,
        resource: new URL(claims.a),
      };
    },

    async revokeToken(client, request) {
      const family =
        findFamily(request.token)?.family ??
        families.get(readAccess(request.token)?.f ?? '');
      if (family && family.clientId === client.client_id) {
        families.delete(family.id);
        save();
        record({ event: 'token_revoke', client: client.client_id });
      }
    },
  };

  /** The verified `sub` when the signed-in account is the configured one. */
  async function accountMatches(code: string, entry: SignIn) {
    const response = await fetchIdp(config.idp.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: config.idp.clientId,
        client_secret: config.idp.clientSecret,
        code_verifier: entry.idpVerifier,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error('The identity provider refused the code.');
    }
    const claims = claimsOf(
      ((await response.json()) as { id_token?: unknown }).id_token,
    );
    if (!claims) return undefined;
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const account = config.idp.account.toLowerCase();
    const matches =
      normalizeIssuer(claims.iss) === normalizeIssuer(config.idp.issuer) &&
      audience.includes(config.idp.clientId) &&
      typeof claims.exp === 'number' &&
      claims.exp > nowS() &&
      claims.nonce === entry.nonce &&
      (claims.sub === config.idp.account ||
        (claims.email_verified === true &&
          typeof claims.email === 'string' &&
          claims.email.toLowerCase() === account));
    // The audit identity is the provider's own subject, never the email.
    return matches && typeof claims.sub === 'string' && claims.sub
      ? claims.sub
      : undefined;
  }

  /** The provider sends the user's browser back here after sign-in. */
  async function callback(req: IncomingMessage, res: ServerResponse) {
    const plain = (status: number, text: string) => {
      res.writeHead(status, {
        'content-type': 'text/plain',
        'cache-control': 'no-store',
      });
      res.end(text);
    };
    if (req.method !== 'GET') return plain(405, 'Method Not Allowed');
    const query = new URL(req.url ?? '/', publicUrl).searchParams;
    const stateKey = query.get('state') ?? '';
    const entry = signIns.get(stateKey);
    signIns.delete(stateKey); // single use
    if (!entry || entry.expiresAt <= now()) {
      record({ event: 'refused', reason: 'sign-in-state' });
      return plain(
        400,
        'This sign-in has expired. Start again from the client.',
      );
    }
    const back = (params: Record<string, string>) => {
      const url = new URL(entry.redirectUri);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      if (entry.state) url.searchParams.set('state', entry.state);
      res.writeHead(302, { location: url.href, 'cache-control': 'no-store' });
      res.end();
    };

    const code = query.get('code');
    if (query.get('error') || !code) {
      record({ event: 'sign_in', status: 'refused', client: entry.clientId });
      return back({ error: 'access_denied' });
    }
    let subject: string | undefined;
    try {
      subject = await accountMatches(code, entry);
    } catch {
      record({ event: 'sign_in', status: 'error', client: entry.clientId });
      return back({ error: 'server_error' });
    }
    if (!subject) {
      record({ event: 'sign_in', status: 'refused', client: entry.clientId });
      return back({ error: 'access_denied' });
    }
    admit(codes, now());
    const authorizationCode = token(32);
    codes.set(authorizationCode, {
      clientId: entry.clientId,
      redirectUri: entry.redirectUri,
      codeChallenge: entry.codeChallenge,
      scopes: entry.scopes,
      subject,
      expiresAt: now() + CODE_TTL_MS,
    });
    record({ event: 'sign_in', status: 'ok', client: entry.clientId });
    back({ code: authorizationCode });
  }

  const app = createMcpExpressApp({ allowedHosts: options.allowedHosts });
  // Rate limits are the hosted entry's own, per endpoint, ahead of this router.
  const noLimit = { rateLimit: false } as const;
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: publicUrl,
      resourceServerUrl: resource,
      scopesSupported: [SCOPE],
      resourceName: 'Actual Budget',
      authorizationOptions: noLimit,
      tokenOptions: noLimit,
      revocationOptions: noLimit,
      clientRegistrationOptions: noLimit,
    }),
  );

  return {
    publicHost: publicUrl.hostname.toLowerCase(),
    resourceMetadataUrl: new URL(
      `/.well-known/oauth-protected-resource${MCP_PATH}`,
      publicUrl,
    ).href,
    handle(req, res) {
      const path = new URL(req.url ?? '/', publicUrl).pathname;
      if (path === CALLBACK_PATH) return callback(req, res);
      app(req, res);
    },
    async authenticate(req) {
      // Only the Authorization header: a token in a URL is never read.
      const [scheme, value, extra] = (req.headers.authorization ?? '').split(
        ' ',
      );
      if (scheme?.toLowerCase() !== 'bearer' || !value || extra !== undefined) {
        return null;
      }
      try {
        const info = await provider.verifyAccessToken(value);
        return info.resource &&
          sameResource(info.resource) &&
          info.scopes.includes(SCOPE)
          ? { clientId: info.clientId, subject: String(info.extra?.subject) }
          : null;
      } catch {
        return null;
      }
    },
  };
}
