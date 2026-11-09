import { format } from 'node:util';

import createDebug from 'debug';
import type * as OpenIdClient from 'openid-client';
import type { MockInstance } from 'vitest';

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

  // fork: sc-2453, every refusal says why in the server log (subject only)
  describe('logs why a sign-in is refused', () => {
    let warn: MockInstance<typeof console.warn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());
    const logged = () => warn.mock.calls.map(args => format(...args));

    it('a first sign-in whose subject is not the admin subject', async () => {
      config.set('openId.adminSubject', 'someone-else');
      expect((await signIn()).error).toBe('openid-grant-failed');
      const lines = logged().filter(l =>
        l.includes('ACTUAL_OPENID_ADMIN_SUBJECT'),
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('fixed-id');
      expect(lines[0]).toContain('someone-else');
      expect(logged().join('\n')).not.toContain('provider-token');
    });

    it('an ID token sub that differs from the userinfo sub', async () => {
      config.set('openId.adminSubject', 'fixed-id');
      provider.callback.mockResolvedValue({
        access_token: 'provider-token',
        id_token: 'x',
        claims: () => ({ sub: 'other', aud: 'client' }),
      });
      await signIn();
      expect(logged().join('\n')).toMatch(/ID token.*subject/i);
      expect(logged().join('\n')).not.toContain('provider-token');
    });

    it('an unknown or disabled user', async () => {
      getAccountDb().mutate(
        "INSERT INTO users (id, user_name, display_name, enabled, owner, role) VALUES ('u3', 'someone', 'x', 1, 1, 'ADMIN')",
      );
      expect((await signIn()).error).toBe('openid-grant-failed');
      expect(logged().join('\n')).toMatch(/no enabled user/i);
    });

    it('an empty identity', async () => {
      provider.userinfo.mockResolvedValue({ sub: 'a', preferred_username: '' });
      await signIn();
      expect(logged().join('\n')).toMatch(/empty identity/i);
    });

    // fork: sc-3068
    it('no identification at all', async () => {
      provider.userinfo.mockResolvedValue({});
      expect((await signIn()).error).toBe(
        'openid-grant-failed: no identification was found',
      );
      expect(logged().join('\n')).toMatch(/no identification/i);
      expect(logged().join('\n')).not.toContain('provider-token');
    });

    it('a subject with line breaks is logged on one line', async () => {
      provider.userinfo.mockResolvedValue({
        sub: 'a\r\nOpenID sign-in refused: forged',
        preferred_username: '',
      });
      await signIn();
      const lines = logged();
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toMatch(/[\r\n]/);
      expect(lines[0]).toContain('forged');
    });

    // fork: sc-3102
    it('escapes backslashes so a subject cannot forge an escape sequence', async () => {
      provider.userinfo.mockResolvedValue({
        sub: 'a\\u000a|b\n',
        preferred_username: '',
      });
      await signIn();
      expect(logged()[0]).toContain('a\\\\u000a|b\\u000a');
    });

    it('escapes format characters such as right-to-left override', async () => {
      provider.userinfo.mockResolvedValue({
        sub: 'a‮b​c',
        preferred_username: '',
      });
      await signIn();
      const line = logged()[0];
      expect(line).toContain('a\\u202eb\\u200bc');
      expect(line).not.toMatch(/[‮​]/);
    });
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
      claims: () => ({
        iss: 'https://identity.example',
        sub: 'other',
        aud: 'client',
      }),
    });
    expect((await signIn()).error).toBe('openid-grant-failed');
    expect(users()).toEqual([]);
  });

  it('accepts a matching ID token sub', async () => {
    config.set('openId.adminSubject', 'fixed-id');
    provider.callback.mockResolvedValue({
      access_token: 'provider-token',
      id_token: 'x',
      claims: () => ({
        iss: 'https://identity.example',
        sub: 'fixed-id',
        aud: 'client',
      }),
    });
    expect((await signIn()).error).toBeUndefined();
  });

  // fork: sc-2719, a household's server accepts only its own sync app's tokens
  describe('ID token audience', () => {
    const sessions = () =>
      getAccountDb().first(
        "SELECT count(*) as n FROM sessions WHERE auth_method = 'openid'",
      ).n;
    function idToken(claims: Record<string, unknown>) {
      provider.callback.mockResolvedValue({
        access_token: 'provider-token',
        id_token: 'x',
        claims: () => ({
          iss: 'https://identity.example',
          sub: 'fixed-id',
          ...claims,
        }),
      });
    }

    it.each([
      ['another app', { aud: 'other-household-client' }],
      ['a list without this app', { aud: ['other-household-client'] }],
      ['no audience', {}],
      [
        'a list with this app but no azp',
        { aud: ['client', 'other-household-client'] },
      ],
      [
        'a list with this app authorized for another',
        { aud: ['client', 'other-household-client'], azp: 'other' },
      ],
      ['a single audience authorized for another', { aud: 'client', azp: 'x' }],
    ])('refuses %s, creating no user and no session', async (_, claims) => {
      idToken(claims);
      expect((await signIn()).error).toBe('openid-grant-failed');
      expect(users()).toEqual([]);
      expect(sessions()).toBe(0);
    });

    it.each([
      ['its own app', { aud: 'client' }],
      ['a one-item list of its own app', { aud: ['client'] }],
      [
        'a list authorized for its own app',
        { aud: ['client', 'other-household-client'], azp: 'client' },
      ],
    ])('accepts %s', async (_, claims) => {
      idToken(claims);
      expect((await signIn()).error).toBeUndefined();
      expect(sessions()).toBe(1);
    });
  });

  // fork: sc-2970, the ID token is kept with its session for the logout hint
  describe('stored ID token', () => {
    const storedIdTokens = () =>
      getAccountDb()
        .all("SELECT id_token FROM sessions WHERE auth_method = 'openid'")
        .map((row: { id_token: string | null }) => row.id_token);
    function withIdToken(aud: string) {
      provider.callback.mockResolvedValue({
        access_token: 'provider-token',
        id_token: 'issued.id.token',
        claims: () => ({
          iss: 'https://identity.example',
          sub: 'fixed-id',
          aud,
        }),
      });
    }

    it('stores the ID token with the new session', async () => {
      withIdToken('client');
      expect((await signIn()).error).toBeUndefined();
      expect(storedIdTokens()).toEqual(['issued.id.token']);
    });

    it('stores NULL when the provider sent no ID token', async () => {
      expect((await signIn()).error).toBeUndefined();
      expect(storedIdTokens()).toEqual([null]);
    });

    it('stores nothing when the ID token fails its checks', async () => {
      withIdToken('other-household-client');
      expect((await signIn()).error).toBe('openid-grant-failed');
      expect(storedIdTokens()).toEqual([]);
    });
  });

  // fork: sc-2719, pins existing refusals of other households' leads and Ken
  describe('another household on this server', () => {
    const leadB = { sub: 'lead-b', preferred_username: 'lead-b@example' };
    const others = [
      ['lead-a', 'lead-a@example'],
      ['ken', 'ken@example'],
    ];

    it.each(others)(
      '%s is refused by admin_subject before this lead signs in',
      async (sub, name) => {
        config.set('openId.adminSubject', leadB.sub);
        provider.userinfo.mockResolvedValue({ sub, preferred_username: name });
        expect((await signIn()).error).toBe('openid-grant-failed');
        expect(users()).toEqual([]);
      },
    );

    it.each(others)(
      '%s is refused by manual creation once this server has users',
      async (sub, name) => {
        config.set('openId.adminSubject', leadB.sub);
        provider.userinfo.mockResolvedValue(leadB);
        expect((await signIn()).error).toBeUndefined();
        provider.userinfo.mockResolvedValue({ sub, preferred_username: name });
        expect((await signIn()).error).toBe('openid-grant-failed');
        expect(users()).toEqual([
          { user_name: 'lead-b@example', role: 'ADMIN', owner: 1 },
        ]);
      },
    );
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

  // fork: sc-2970
  it('adds the ID token as id_token_hint when given one', async () => {
    provider.metadata = {
      end_session_endpoint: 'https://identity.example/oidc/logout',
    };
    const url = new URL((await getProviderLogoutUrl('stored.id.token')) ?? '');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client',
      post_logout_redirect_uri: 'https://actual.example/',
      id_token_hint: 'stored.id.token',
    });
  });

  it('never adds the hint to the Auth0 /v2/logout fallback', async () => {
    useIssuer('https://tenant.us.auth0.com/.well-known/openid-configuration');
    expect(await getProviderLogoutUrl('stored.id.token')).toBe(
      'https://tenant.us.auth0.com/v2/logout?client_id=client&returnTo=https%3A%2F%2Factual.example%2F',
    );
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
