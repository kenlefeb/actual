import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type OpenIdUser = { sub: string; email: string; name: string };

export type OpenIdProvider = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  // Who the next authorize request signs in as; change it to switch users
  user: OpenIdUser;
  // Every request the browser or the sync server made, in order
  requests: URL[];
  stop: () => Promise<void>;
};

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

/**
 * A local OpenID provider for e2e tests: discovery, authorize (approves at
 * once, no login form), token, userinfo, JWKS and an end-session page that
 * moves on to `post_logout_redirect_uri`. ID tokens are RS256, signed
 * with a key generated per instance. Synthetic users only.
 *
 * shortcut: client secret, PKCE and redirect URIs are not checked; add the
 * checks if a test ever needs the provider to refuse a request.
 */
export async function startOpenIdProvider(): Promise<OpenIdProvider> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256' };
  const codes = new Map<string, OpenIdUser>();
  const tokens = new Map<string, OpenIdUser>();

  const provider: OpenIdProvider = {
    issuer: '',
    clientId: 'e2e-client',
    clientSecret: 'e2e-secret',
    user: { sub: 'e2e|alice', email: 'alice@example.test', name: 'E2E Alice' },
    requests: [],
    stop: () =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };

  function idToken(user: OpenIdUser, accessToken: string) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const hash = createHash('sha256').update(accessToken).digest();
    const payload = base64url(
      JSON.stringify({
        iss: provider.issuer,
        aud: provider.clientId,
        sub: user.sub,
        email: user.email,
        name: user.name,
        iat: now,
        exp: now + 600,
        at_hash: base64url(hash.subarray(0, hash.length / 2)),
      }),
    );
    const signature = sign(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      privateKey,
    );
    return `${header}.${payload}.${base64url(signature)}`;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', provider.issuer);
    provider.requests.push(url);
    let body = '';
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);

    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const redirect = (location: URL | string) => {
      res.writeHead(302, { Location: location.toString() });
      res.end();
    };

    switch (url.pathname) {
      case '/.well-known/openid-configuration':
        return json(200, {
          issuer: provider.issuer,
          authorization_endpoint: `${provider.issuer}/authorize`,
          token_endpoint: `${provider.issuer}/token`,
          userinfo_endpoint: `${provider.issuer}/userinfo`,
          jwks_uri: `${provider.issuer}/jwks`,
          end_session_endpoint: `${provider.issuer}/logout`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        });
      case '/jwks':
        return json(200, { keys: [jwk] });
      case '/authorize': {
        const redirectUri = url.searchParams.get('redirect_uri');
        if (!redirectUri) return json(400, { error: 'invalid_request' });
        const code = randomUUID();
        codes.set(code, provider.user);
        const target = new URL(redirectUri);
        target.searchParams.set('code', code);
        target.searchParams.set('state', url.searchParams.get('state') ?? '');
        return redirect(target);
      }
      case '/token': {
        const user = codes.get(form.get('code') ?? '');
        if (!user) return json(400, { error: 'invalid_grant' });
        codes.delete(form.get('code') ?? '');
        const accessToken = randomUUID();
        tokens.set(accessToken, user);
        return json(200, {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 600,
          id_token: idToken(user, accessToken),
        });
      }
      case '/userinfo': {
        const token = req.headers.authorization?.replace(/^Bearer /, '');
        const user = tokens.get(token ?? '');
        if (!user) return json(401, { error: 'invalid_token' });
        return json(200, user);
      }
      case '/logout': {
        // A page that moves on, like a real provider's, rather than a 302: the
        // browser then makes a fresh request that a test can route
        const target = url.searchParams.get('post_logout_redirect_uri');
        if (!target || !URL.canParse(target)) {
          return json(200, { loggedOut: true });
        }
        const href = new URL(target).href
          .replaceAll('&', '&amp;')
          .replaceAll('"', '&quot;');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(
          `<!doctype html><meta http-equiv="refresh" content="0;url=${href}"><title>Signed out</title>`,
        );
      }
      default:
        return json(404, { error: 'not_found' });
    }
  });

  await new Promise<void>(resolve => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  provider.issuer = `http://localhost:${port}`;
  return provider;
}
