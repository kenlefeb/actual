import { format } from 'node:util';

import createDebug from 'debug';
import type * as OpenIdClient from 'openid-client';

import { getAccountDb } from '#account-db';
import { config } from '#load-config';

import {
  bootstrapOpenId,
  getProviderLogoutUrl,
  loginWithOpenIdFinalize,
  loginWithOpenIdSetup,
} from './openid';

const provider = vi.hoisted(() => ({
  callback: vi.fn(),
  userinfo: vi.fn(),
  metadata: {} as Record<string, string>,
  discoveryFails: false,
}));

vi.mock('openid-client', async importOriginal => {
  const actual = await importOriginal<typeof OpenIdClient>();
  return {
    ...actual,
    Issuer: {
      discover: async () => {
        if (provider.discoveryFails) throw new Error('discovery down');
        // A real issuer, so endSessionUrl is openid-client's own.
        const issuer = new actual.Issuer({
          issuer: 'https://identity.example',
          ...provider.metadata,
        });
        class Client extends issuer.Client {
          callback = provider.callback;
          userinfo = provider.userinfo;
          authorizationUrl(params: Record<string, string>) {
            return `https://identity.example/authorize?${new URLSearchParams(params).toString()}`;
          }
        }
        return { Client };
      },
    },
  };
});

beforeEach(() => {
  provider.metadata = {};
  provider.discoveryFails = false;
  getAccountDb().mutate("DELETE FROM sessions WHERE auth_method = 'openid'");
  getAccountDb().mutate(
    'INSERT INTO auth (method, active, extra_data) VALUES (?, 1, ?)',
    [
      'openid',
      JSON.stringify({
        issuer: 'https://identity.example',
        client_id: 'client',
        client_secret: 'secret',
        server_hostname: 'https://actual.example',
      }),
    ],
  );
  provider.callback.mockReset().mockResolvedValue({
    access_token: 'provider-token',
    claims: () => ({ iss: 'https://identity.example', sub: 'fixed-id' }),
  });
  provider.userinfo.mockReset().mockResolvedValue({
    sub: 'fixed-id',
    preferred_username: 'renamed-admin',
  });
});

afterEach(() => {
  const db = getAccountDb();
  db.mutate("DELETE FROM auth WHERE method = 'openid'");
  db.mutate('DELETE FROM pending_openid_requests');
  db.mutate("DELETE FROM sessions WHERE auth_method = 'openid'");
});

it.each(['', 'actual:*', 'actual-sensitive:openid'])(
  'keeps provider details behind the sensitive namespace (%s)',
  async namespaces => {
    const previous = createDebug.disable();
    createDebug.enable(namespaces);
    const debugLog = vi
      .spyOn(createDebug, 'log')
      .mockImplementation(() => undefined);
    const secret = 'private-provider-code-and-token';
    const start = await loginWithOpenIdSetup('https://actual.example');
    const state = new URL(start.url ?? '').searchParams.get('state');
    provider.callback.mockRejectedValue(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await loginWithOpenIdFinalize({ code: secret, state });
      expect(result.error).toBeTruthy();
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      const details = debugLog.mock.calls
        .map(args => format(...args))
        .join('\n');
      expect(details.includes(secret)).toBe(
        namespaces === 'actual-sensitive:openid',
      );
      if (namespaces === 'actual-sensitive:openid') {
        expect(details).toContain('Error:');
        expect(details).toContain('openid.test.ts:');
      }
    } finally {
      log.mockRestore();
      debugLog.mockRestore();
      createDebug.enable(previous);
    }
  },
);

describe('first sign-in must match the configured admin subject', () => {
  async function signIn() {
    const start = await loginWithOpenIdSetup('https://actual.example');
    const state = new URL(start.url ?? '').searchParams.get('state');
    return loginWithOpenIdFinalize({ code: 'code', state });
  }
  const users = () =>
    getAccountDb().all(
      "SELECT user_name, role, owner FROM users WHERE user_name <> ''",
    );

  // The account database is shared by every test file, so empty the users
  // table inside a transaction that is rolled back afterwards.
  beforeEach(() => {
    const db = getAccountDb();
    db.exec('BEGIN');
    const named = "(SELECT id FROM users WHERE user_name <> '')";
    db.mutate(`DELETE FROM sessions WHERE user_id IN ${named}`);
    db.mutate(`DELETE FROM user_access WHERE user_id IN ${named}`);
    db.mutate("DELETE FROM users WHERE user_name <> ''");
  });
  afterEach(() => {
    getAccountDb().exec('ROLLBACK');
    config.set('openId.adminSubject', '');
  });

  it('a matching first sign-in becomes ADMIN and owner', async () => {
    config.set('openId.adminSubject', 'fixed-id');
    const result = await signIn();
    expect(result.error).toBeUndefined();
    expect(users()).toEqual([
      { user_name: 'renamed-admin', role: 'ADMIN', owner: 1 },
    ]);
  });

  it('a non-matching first sign-in is refused and creates nothing', async () => {
    config.set('openId.adminSubject', 'someone-else');
    const result = await signIn();
    expect(result.error).toBe('openid-grant-failed');
    expect(users()).toEqual([]);
    expect(
      getAccountDb().first(
        "SELECT count(*) as n FROM sessions WHERE auth_method = 'openid'",
      ).n,
    ).toBe(0);
  });

  it('a non-matching first sign-in is refused even when users are created at login', async () => {
    config.set('openId.adminSubject', 'someone-else');
    config.set('userCreationMode', 'login');
    try {
      expect((await signIn()).error).toBe('openid-grant-failed');
      expect(users()).toEqual([]);
    } finally {
      config.set('userCreationMode', 'manual');
    }
  });

  it('with the setting absent, the first sign-in becomes ADMIN as upstream does', async () => {
    const result = await signIn();
    expect(result.error).toBeUndefined();
    expect(users()).toEqual([
      { user_name: 'renamed-admin', role: 'ADMIN', owner: 1 },
    ]);
  });

  it('later sign-ins are unaffected by the setting', async () => {
    getAccountDb().mutate(
      "INSERT INTO users (id, user_name, display_name, enabled, owner, role) VALUES ('u2', 'renamed-admin', 'x', 1, 1, 'ADMIN')",
    );
    config.set('openId.adminSubject', 'someone-else');
    const result = await signIn();
    expect(result.error).toBeUndefined();
  });

  it('an empty identity cannot reach the password-method user', async () => {
    expect(
      getAccountDb().first("SELECT id FROM users WHERE user_name = ''"),
    ).toBeTruthy();
    config.set('openId.adminSubject', 'someone-else');
    for (const empty of ['', '   ']) {
      provider.userinfo.mockResolvedValue({
        sub: 'attacker',
        preferred_username: empty,
      });
      expect((await signIn()).error).toBe('openid-grant-failed');
    }
    expect(
      getAccountDb().first(
        "SELECT count(*) as n FROM sessions WHERE auth_method = 'openid'",
      ).n,
    ).toBe(0);
  });

  it('refuses a sign-in whose ID token sub differs from the userinfo sub', async () => {
    config.set('openId.adminSubject', 'fixed-id');
    provider.callback.mockResolvedValue({
      access_token: 'provider-token',
      id_token: 'x',
      claims: () => ({ iss: 'https://identity.example', sub: 'other' }),
    });
    expect((await signIn()).error).toBe('openid-grant-failed');
    expect(users()).toEqual([]);
  });

  it('accepts a matching ID token sub', async () => {
    config.set('openId.adminSubject', 'fixed-id');
    provider.callback.mockResolvedValue({
      access_token: 'provider-token',
      id_token: 'x',
      claims: () => ({ iss: 'https://identity.example', sub: 'fixed-id' }),
    });
    expect((await signIn()).error).toBeUndefined();
  });

  it('warns at startup when the setting is unset, and not when set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const params = {
      issuer: 'https://identity.example',
      client_id: 'client',
      client_secret: 'secret',
      server_hostname: 'https://actual.example',
    };
    try {
      await bootstrapOpenId({ ...params });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ACTUAL_OPENID_ADMIN_SUBJECT'),
      );
      warn.mockClear();
      config.set('openId.adminSubject', 'fixed-id');
      await bootstrapOpenId({ ...params });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('getProviderLogoutUrl', () => {
  function useIssuer(issuer: string) {
    getAccountDb().mutate(
      "UPDATE auth SET extra_data = ? WHERE method = 'openid'",
      [
        JSON.stringify({
          issuer,
          client_id: 'client',
          client_secret: 'secret',
          server_hostname: 'https://actual.example',
        }),
      ],
    );
  }

  it('uses the discovery end_session_endpoint with the server base URL', async () => {
    provider.metadata = {
      end_session_endpoint: 'https://identity.example/oidc/logout',
    };
    const url = new URL((await getProviderLogoutUrl()) ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://identity.example/oidc/logout',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client',
      post_logout_redirect_uri: 'https://actual.example/',
    });
  });

  it.each(['tenant.us.auth0.com', 'auth0.com'])(
    'falls back to /v2/logout for the Auth0 host %s',
    async host => {
      useIssuer(`https://${host}/.well-known/openid-configuration`);
      expect(await getProviderLogoutUrl()).toBe(
        `https://${host}/v2/logout?client_id=client&returnTo=https%3A%2F%2Factual.example%2F`,
      );
    },
  );

  it.each([
    'https://evil-auth0.com/.well-known/openid-configuration',
    'https://auth0.com.evil.example/.well-known/openid-configuration',
    'https://identity.example/.well-known/openid-configuration',
  ])('returns nothing and warns for %s without an endpoint', async issuer => {
    useIssuer(issuer);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await getProviderLogoutUrl()).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('returns nothing when discovery fails', async () => {
    provider.discoveryFails = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await getProviderLogoutUrl()).toBeNull();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
