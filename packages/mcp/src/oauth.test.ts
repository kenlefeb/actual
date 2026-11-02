import { createHash, randomBytes } from 'crypto';
import { mkdtempSync, readFileSync, statSync } from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { createOAuthServer } from './oauth';
import type { OAuthConfig } from './oauth';
import { createRemoteHttpServer } from './remote';
import type { RemoteConfig } from './remote-config';

const PUBLIC = 'https://mcp.example.test';
const RESOURCE = `${PUBLIC}/mcp`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const SIGNING_KEY = 'signing-key-0123456789abcdef0123456789abcdef';
const CLIENT_SECRET = 'registered-client-secret-9f8e7d6c5b4a';
const IDP_SECRET = 'idp-client-secret-1a2b3c4d5e6f';
const ACCOUNT = 'agent@example.test';
const DAY = 86_400_000;

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const jwt = (claims: Record<string, unknown>) =>
  `${b64u('{"alg":"RS256"}')}.${b64u(JSON.stringify(claims))}.sig`;

type Res = {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: Record<string, unknown>;
};

let dir: string;
let server: http.Server;
let port: number;
let records: Array<Record<string, unknown>>;
let clock: { t: number };
let idp: {
  email: string;
  verified: boolean;
  nonce: string;
  aud: string;
  iss: string;
  calls: URLSearchParams[];
};

function oauthConfig(over: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    publicUrl: PUBLIC,
    signingKey: SIGNING_KEY,
    clientId: 'claude-staging',
    clientSecret: CLIENT_SECRET,
    redirectUris: [REDIRECT],
    allowDynamicRegistration: false,
    stateFile: join(dir, 'oauth-state.json'),
    idp: {
      issuer: 'https://idp.example.test',
      authorizationUrl: 'https://idp.example.test/auth',
      tokenUrl: 'https://idp.example.test/token',
      clientId: 'idp-client',
      clientSecret: IDP_SECRET,
      account: ACCOUNT,
    },
    ...over,
  };
}

function remoteConfig(
  oauth: OAuthConfig,
  over: Partial<RemoteConfig> = {},
): RemoteConfig {
  return {
    serverUrl: 'http://127.0.0.1:1',
    password: 'pw',
    syncId: 'sync',
    encryptionPassword: undefined,
    dataDir: dir,
    env: 'staging',
    writes: false,
    auditLog: '',
    secrets: ['pw', SIGNING_KEY, CLIENT_SECRET, IDP_SECRET],
    listen: { host: '0.0.0.0', port: 0 },
    allowedHosts: [new URL(oauth.publicUrl).hostname],
    allowedOrigins: [],
    syncIntervalMs: 300_000,
    rate: { perEndpoint: 1000, perClient: 1000, windowMs: 60_000 },
    oauth,
    ...over,
  };
}

const fakeFetch: typeof fetch = async (url, init) => {
  const body = new URLSearchParams(String(init?.body));
  idp.calls.push(body);
  expect(String(url)).toBe('https://idp.example.test/token');
  return new Response(
    JSON.stringify({
      id_token: jwt({
        iss: idp.iss,
        aud: idp.aud,
        sub: '1234567890',
        email: idp.email,
        email_verified: idp.verified,
        nonce: idp.nonce,
        exp: Math.floor(clock.t / 1000) + 300,
      }),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
};

async function start(
  over: Partial<OAuthConfig> = {},
  remoteOver: Partial<RemoteConfig> = {},
) {
  const oauth = oauthConfig(over);
  const config = remoteConfig(oauth, remoteOver);
  const record = (r: Record<string, unknown>) => records.push(r);
  server = createRemoteHttpServer(config, {
    log: record,
    oauth: createOAuthServer(oauth, {
      record,
      allowedHosts: config.allowedHosts,
      fetch: fakeFetch,
      now: () => clock.t,
    }),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
}

async function stop() {
  await new Promise<void>(resolve => server.close(() => resolve()));
}

function raw({
  method = 'GET',
  path = '/',
  headers = {},
  body,
}: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
} = {}) {
  return new Promise<Res>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { host: 'mcp.example.test', ...headers },
      },
      res => {
        let text = '';
        res.on('data', chunk => (text += chunk));
        res.on('end', () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON */
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text,
            json,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const form = (params: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(params).toString(),
});

const sha256 = (v: string) =>
  createHash('sha256').update(v).digest('base64url');

function pkce() {
  const verifier = b64u(randomBytes(32));
  return { verifier, challenge: sha256(verifier) };
}

/** GET /authorize with a valid request unless overridden. */
async function authorize(over: Record<string, string> = {}) {
  const { verifier, challenge } = pkce();
  const params = {
    response_type: 'code',
    client_id: 'claude-staging',
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'client-state',
    scope: 'budget:read',
    resource: RESOURCE,
    ...over,
  };
  const res = await raw({
    path: `/authorize?${new URLSearchParams(params).toString()}`,
  });
  return { res, verifier };
}

/** The whole browser leg: /authorize, the provider's sign-in, /oauth/callback. */
async function login(
  idpOver: Partial<typeof idp> = {},
  authOver: Record<string, string> = {},
) {
  const { res, verifier } = await authorize(authOver);
  expect(res.status).toBe(302);
  const upstream = new URL(String(res.headers.location));
  expect(upstream.origin + upstream.pathname).toBe(
    'https://idp.example.test/auth',
  );
  idp.nonce = upstream.searchParams.get('nonce') ?? '';
  Object.assign(idp, idpOver);
  const callback = await raw({
    path: `/oauth/callback?${new URLSearchParams({
      code: 'idp-code',
      state: upstream.searchParams.get('state') ?? '',
    }).toString()}`,
  });
  const back = callback.headers.location
    ? new URL(String(callback.headers.location))
    : undefined;
  return {
    verifier,
    callback,
    back,
    code: back?.searchParams.get('code') ?? undefined,
    upstream,
  };
}

const clientAuth = {
  client_id: 'claude-staging',
  client_secret: CLIENT_SECRET,
};

async function exchange(code: string, verifier: string, over = {}) {
  return raw({
    path: '/token',
    ...form({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      ...clientAuth,
      ...over,
    }),
  });
}

async function signIn() {
  const { code, verifier } = await login();
  const res = await exchange(code!, verifier);
  expect(res.status).toBe(200);
  return res.json as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

const refresh = (token: string, over = {}) =>
  raw({
    path: '/token',
    ...form({
      grant_type: 'refresh_token',
      refresh_token: token,
      ...clientAuth,
      ...over,
    }),
  });

const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
});

const callMcp = (token?: string, path = '/mcp') =>
  raw({
    method: 'POST',
    path,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: INIT,
  });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'actual-mcp-oauth-'));
  records = [];
  clock = { t: Date.UTC(2026, 10, 1, 12) };
  idp = {
    email: ACCOUNT,
    verified: true,
    nonce: '',
    aud: 'idp-client',
    iss: 'https://idp.example.test',
    calls: [],
  };
  await start();
});

afterEach(stop);

describe('authenticated with OAuth', () => {
  it('No token', async () => {
    const res = await callMcp();
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain(
      `resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('A valid token reaches the MCP endpoint', async () => {
    const tokens = await signIn();
    const res = await callMcp(tokens.access_token);
    expect(res.status).toBe(200);
    expect(res.text).toContain('serverInfo');
  });

  it('The flow completes with PKCE and the metadata names this server', async () => {
    const meta = await raw({ path: '/.well-known/oauth-authorization-server' });
    expect(meta.json).toMatchObject({
      issuer: `${PUBLIC}/`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint: `${PUBLIC}/token`,
    });
    const resource = await raw({
      path: '/.well-known/oauth-protected-resource/mcp',
    });
    expect(resource.json).toMatchObject({ resource: RESOURCE });
    // A wrong verifier cannot redeem a code, and a code is single use.
    const first = await login();
    expect((await exchange(first.code!, pkce().verifier)).json.error).toBe(
      'invalid_grant',
    );
    const second = await login();
    expect((await exchange(second.code!, second.verifier)).status).toBe(200);
    expect((await exchange(second.code!, second.verifier)).json.error).toBe(
      'invalid_grant',
    );
  });

  it('A token for another resource', async () => {
    const tokens = await signIn();
    // A second instance for another public URL that shares the key and state.
    const here = server;
    const herePort = port;
    await start({ publicUrl: 'https://other.example.test' });
    const res = await raw({
      method: 'POST',
      path: '/mcp',
      headers: {
        host: 'other.example.test',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${tokens.access_token}`,
      },
      body: INIT,
    });
    expect(res.status).toBe(401);
    await stop();
    server = here;
    port = herePort;
  });

  it('A token in the query string', async () => {
    const tokens = await signIn();
    for (const name of ['access_token', 'token']) {
      const res = await callMcp(
        undefined,
        `/mcp?${name}=${tokens.access_token}`,
      );
      expect(res.status).toBe(401);
    }
    // A token is also refused when the scheme is not Bearer.
    const res = await raw({
      method: 'POST',
      path: '/mcp',
      headers: { authorization: `Basic ${tokens.access_token}` },
      body: INIT,
    });
    expect(res.status).toBe(401);
  });

  it('A tampered token', async () => {
    const tokens = await signIn();
    const [payload, sig] = tokens.access_token.split('.');
    const forged = b64u(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        exp: 9_999_999_999,
      }),
    );
    expect((await callMcp(`${forged}.${sig}`)).status).toBe(401);
    expect((await callMcp('not-a-token')).status).toBe(401);
  });
});

describe('short-lived, revocable tokens', () => {
  it('Access tokens last an hour at most', async () => {
    const tokens = await signIn();
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.expires_in).toBeLessThanOrEqual(3600);
    clock.t += 3601_000;
    expect((await callMcp(tokens.access_token)).status).toBe(401);
  });

  it('A revoked refresh token', async () => {
    const tokens = await signIn();
    const revoked = await raw({
      path: '/revoke',
      ...form({ token: tokens.refresh_token, ...clientAuth }),
    });
    expect(revoked.status).toBe(200);
    const res = await refresh(tokens.refresh_token);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('invalid_grant');
    // The access token it produced stops with it.
    expect((await callMcp(tokens.access_token)).status).toBe(401);
    expect(records).toContainEqual(
      expect.objectContaining({ event: 'token_revoke' }),
    );
  });

  it('An expired refresh token', async () => {
    const tokens = await signIn();
    clock.t += 29 * DAY;
    const latest = (await refresh(tokens.refresh_token)).json as {
      refresh_token: string;
    };
    clock.t += 2 * DAY; // 31 days after the sign-in
    // The newest token carries no extra life: the family ends 30 days in.
    const res = await refresh(latest.refresh_token);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('invalid_grant');
  });

  it('A refresh token issued 31 days ago', async () => {
    const tokens = await signIn();
    clock.t += 31 * DAY;
    const res = await refresh(tokens.refresh_token);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('invalid_grant');
  });

  it('A refresh rotates the token and a replay revokes the family', async () => {
    const first = await signIn();
    const second = (await refresh(first.refresh_token)).json as {
      refresh_token: string;
      access_token: string;
    };
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await callMcp(second.access_token)).status).toBe(200);
    expect((await refresh(first.refresh_token)).json.error).toBe(
      'invalid_grant',
    );
    // The replay burned the whole family.
    expect((await refresh(second.refresh_token)).status).toBe(400);
    expect((await callMcp(second.access_token)).status).toBe(401);
  });

  it('A refresh token is bound to its client', async () => {
    const tokens = await signIn();
    await stop();
    await start({ allowDynamicRegistration: true });
    const reg = await raw({
      method: 'POST',
      path: '/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'client_secret_post',
      }),
    });
    expect(reg.status).toBe(201);
    const res = await refresh(tokens.refresh_token, {
      client_id: reg.json.client_id as string,
      client_secret: reg.json.client_secret as string,
    });
    expect(res.status).toBe(400);
  });

  it('Rotating the signing key', async () => {
    const tokens = await signIn();
    expect((await callMcp(tokens.access_token)).status).toBe(200);
    await stop();
    await start({ signingKey: 'a-different-signing-key-0123456789abcdef0123' });
    expect((await callMcp(tokens.access_token)).status).toBe(401);
    expect((await refresh(tokens.refresh_token)).status).toBe(400);
  });

  it('A restart keeps refresh tokens, and the state file holds no raw token', async () => {
    const tokens = await signIn();
    await stop();
    await start();
    expect((await refresh(tokens.refresh_token)).status).toBe(200);
    const file = join(dir, 'oauth-state.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const stored = readFileSync(file, 'utf8');
    expect(stored).not.toContain(tokens.refresh_token);
    expect(stored).not.toContain(tokens.access_token);
    expect(stored).not.toContain(SIGNING_KEY);
  });

  it('Events are recorded without tokens or secrets', async () => {
    const tokens = await signIn();
    await refresh(tokens.refresh_token);
    const logged = JSON.stringify(records);
    expect(records.map(r => r.event)).toEqual(
      expect.arrayContaining(['sign_in', 'token_issue', 'token_refresh']),
    );
    for (const secret of [
      tokens.access_token,
      tokens.refresh_token,
      SIGNING_KEY,
      CLIENT_SECRET,
      IDP_SECRET,
      ACCOUNT,
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('exactly one identity', () => {
  it('Another account', async () => {
    const { callback, back, code } = await login({
      email: 'someone-else@example.test',
    });
    expect(callback.status).toBe(302);
    expect(code).toBeUndefined();
    expect(back?.searchParams.get('error')).toBe('access_denied');
    expect(back?.searchParams.get('state')).toBe('client-state');
    expect(`${back?.origin}${back?.pathname}`).toBe(REDIRECT);
    expect(records).toContainEqual(
      expect.objectContaining({ event: 'sign_in', status: 'refused' }),
    );
  });

  it('The configured account', async () => {
    const { code, back, upstream } = await login();
    expect(code).toBeTruthy();
    expect(back?.searchParams.get('state')).toBe('client-state');
    // The provider is told to use PKCE and a nonce, and our callback URL.
    expect(upstream.searchParams.get('code_challenge_method')).toBe('S256');
    expect(upstream.searchParams.get('redirect_uri')).toBe(
      `${PUBLIC}/oauth/callback`,
    );
    expect(idp.calls[0].get('code_verifier')).toBeTruthy();
    expect(idp.calls[0].get('client_secret')).toBe(IDP_SECRET);
  });

  it('The configured account matches case-insensitively and only when verified', async () => {
    expect((await login({ email: ACCOUNT.toUpperCase() })).code).toBeTruthy();
    expect((await login({ verified: false })).code).toBeUndefined();
  });

  it('An account identifier may be the stable subject', async () => {
    await stop();
    await start({
      idp: { ...oauthConfig().idp, account: '1234567890' },
    });
    expect((await login({ email: 'other@example.test' })).code).toBeTruthy();
  });

  it('A sign-in for another audience, issuer or nonce is refused', async () => {
    expect((await login({ aud: 'someone-elses-client' })).code).toBeUndefined();
    expect(
      (await login({ aud: 'idp-client', iss: 'https://evil.example.test' }))
        .code,
    ).toBeUndefined();
    Object.assign(idp, { aud: 'idp-client', iss: 'https://idp.example.test' });
    const { res } = await authorize();
    const upstream = new URL(String(res.headers.location));
    idp.nonce = 'a-different-nonce';
    const cb = await raw({
      path: `/oauth/callback?code=x&state=${upstream.searchParams.get('state')}`,
    });
    expect(new URL(String(cb.headers.location)).searchParams.get('code')).toBe(
      null,
    );
  });

  it('A sign-in state is single use and unknown states are refused', async () => {
    const { res } = await authorize();
    const state = new URL(String(res.headers.location)).searchParams.get(
      'state',
    );
    idp.nonce = new URL(String(res.headers.location)).searchParams.get(
      'nonce',
    )!;
    expect(
      (await raw({ path: `/oauth/callback?code=x&state=${state}` })).status,
    ).toBe(302);
    expect(
      (await raw({ path: `/oauth/callback?code=x&state=${state}` })).status,
    ).toBe(400);
    expect(
      (await raw({ path: '/oauth/callback?code=x&state=nope' })).status,
    ).toBe(400);
    expect(
      (await raw({ method: 'POST', path: '/oauth/callback' })).status,
    ).toBe(405);
  });

  it('The provider denying the sign-in issues nothing', async () => {
    const { res } = await authorize();
    const state = new URL(String(res.headers.location)).searchParams.get(
      'state',
    );
    const cb = await raw({
      path: `/oauth/callback?error=access_denied&state=${state}`,
    });
    const back = new URL(String(cb.headers.location));
    expect(back.searchParams.get('code')).toBeNull();
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(idp.calls).toHaveLength(0);
  });
});

describe('clients are registered, not open', () => {
  it('A foreign redirect URI', async () => {
    const { res } = await authorize({
      redirect_uri: 'https://evil.example.test/callback',
    });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    // Near misses are not matches either.
    for (const near of [
      `${REDIRECT}/`,
      `${REDIRECT}?x=1`,
      REDIRECT.replace('https', 'http'),
    ]) {
      expect((await authorize({ redirect_uri: near })).res.status).toBe(400);
    }
  });

  it('An unknown client', async () => {
    expect((await authorize({ client_id: 'someone-else' })).res.status).toBe(
      400,
    );
    const res = await exchange('x', 'y', { client_id: 'someone-else' });
    expect(res.status).toBe(400);
  });

  it('The client secret is required', async () => {
    const { code, verifier } = await login();
    expect(
      (await exchange(code!, verifier, { client_secret: 'wrong' })).json.error,
    ).toBe('invalid_client');
    const noSecret = form({
      grant_type: 'authorization_code',
      code: code!,
      code_verifier: verifier,
      client_id: 'claude-staging',
    });
    expect((await raw({ path: '/token', ...noSecret })).json.error).toBe(
      'invalid_client',
    );
    // The failed attempts did not spend the code.
    expect((await exchange(code!, verifier)).status).toBe(200);
  });

  it('PKCE is required and only S256 is accepted', async () => {
    const plain = await authorize({ code_challenge_method: 'plain' });
    expect(
      new URL(String(plain.res.headers.location)).searchParams.get('error'),
    ).toBe('invalid_request');
    const missing = await raw({
      path: `/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: 'claude-staging',
        redirect_uri: REDIRECT,
        code_challenge_method: 'S256',
      }).toString()}`,
    });
    expect(
      new URL(String(missing.headers.location)).searchParams.get('code'),
    ).toBeNull();
  });

  it('A request for another resource or scope', async () => {
    const resource = await authorize({
      resource: 'https://other.example.test/mcp',
    });
    expect(
      new URL(String(resource.res.headers.location)).searchParams.get('error'),
    ).toBe('invalid_target');
    const scope = await authorize({ scope: 'budget:write' });
    expect(
      new URL(String(scope.res.headers.location)).searchParams.get('error'),
    ).toBe('invalid_scope');
  });

  it('Registration is off by default', async () => {
    const res = await raw({
      method: 'POST',
      path: '/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT] }),
    });
    expect(res.status).toBe(404);
    const meta = await raw({ path: '/.well-known/oauth-authorization-server' });
    expect(meta.json.registration_endpoint).toBeUndefined();
  });

  it('Registration, when on, is limited to the allowlist', async () => {
    await stop();
    await start({ allowDynamicRegistration: true });
    const register = (uris: string[]) =>
      raw({
        method: 'POST',
        path: '/register',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: uris }),
      });
    expect((await register(['https://evil.example.test/cb'])).status).toBe(400);
    expect(
      (await register([REDIRECT, 'https://evil.example.test/cb'])).status,
    ).toBe(400);
    expect((await register([REDIRECT])).status).toBe(201);
  });
});

describe('host, origin and rate checks cover the OAuth endpoints', () => {
  const ENDPOINTS = [
    '/mcp',
    '/authorize',
    '/token',
    '/revoke',
    '/register',
    '/oauth/callback',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource/mcp',
  ];

  it('A rebinding host is refused before authentication', async () => {
    for (const path of ENDPOINTS) {
      for (const host of [
        'evil.example.test',
        'localhost',
        '127.0.0.1',
        '[::1]',
      ]) {
        const res = await raw({
          method: 'POST',
          path,
          headers: { host },
          body: INIT,
        });
        expect(res.status).toBe(403);
      }
    }
    expect(idp.calls).toHaveLength(0);
    expect(records.filter(r => r.reason === 'host').length).toBeGreaterThan(0);
    expect(records.some(r => r.reason === 'unauthenticated')).toBe(false);
  });

  it('A browser origin is refused', async () => {
    const res = await raw({
      path: '/.well-known/oauth-authorization-server',
      headers: { origin: 'https://evil.example.test' },
    });
    expect(res.status).toBe(403);
  });

  it('Each OAuth endpoint has its own rate-limit bucket', async () => {
    for (const hot of ENDPOINTS) {
      await stop();
      await start(
        {},
        { rate: { perEndpoint: 3, perClient: 1000, windowMs: 60_000 } },
      );
      const hit = (path: string) =>
        raw({ method: 'POST', path, body: '{}' }).then(r => r.status);
      for (let i = 0; i < 3; i++) expect(await hit(hot)).not.toBe(429);
      expect(await hit(hot)).toBe(429);
      for (const other of ENDPOINTS.filter(p => p !== hot)) {
        expect(await hit(other)).not.toBe(429);
      }
    }
  });
});

describe('outbound requests', () => {
  it('Only the configured provider is called', async () => {
    await login();
    expect(idp.calls).toHaveLength(1);
  });
});
