import { format } from 'node:util';

import createDebug from 'debug';
import type * as OpenIdClient from 'openid-client';

import { getAccountDb } from '#account-db';
import { config } from '#load-config';

import { loginWithOpenIdFinalize, loginWithOpenIdSetup } from './openid';

const provider = vi.hoisted(() => ({
  callback: vi.fn(),
  userinfo: vi.fn(),
}));

vi.mock('openid-client', async importOriginal => {
  const actual = await importOriginal<typeof OpenIdClient>();
  class Client {
    redirect_uris = ['https://actual.example/openid/callback'];
    callback = provider.callback;
    userinfo = provider.userinfo;
    authorizationUrl(params: Record<string, string>) {
      return `https://identity.example/authorize?${new URLSearchParams(params).toString()}`;
    }
  }
  return { ...actual, Issuer: { discover: async () => ({ Client }) } };
});

beforeEach(() => {
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
});
