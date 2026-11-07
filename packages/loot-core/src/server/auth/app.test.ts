import * as asyncStorage from '#platform/server/asyncStorage';
import { post } from '#server/post';

import { app } from './app';

vi.mock('#server/post', () => ({ post: vi.fn(), get: vi.fn() }));

const signOut = app.handlers['subscribe-sign-out'];
const removedKeys = ['user-token', 'encrypt-keys', 'lastBudget', 'readOnly'];
const providerLogoutUrl = 'https://identity.example/oidc/logout?client_id=c';

let removedBeforeReturn: string[] | null;

beforeEach(() => {
  removedBeforeReturn = null;
  vi.mocked(post).mockReset().mockResolvedValue({ providerLogoutUrl });
  vi.spyOn(asyncStorage, 'getItem').mockResolvedValue('session-token');
  vi.spyOn(asyncStorage, 'multiRemove').mockImplementation(async keys => {
    removedBeforeReturn = keys;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('returns the provider logout URL only for an explicit sign-out', async () => {
  expect(await signOut({ endProviderSession: true })).toEqual({
    providerLogoutUrl,
  });
  expect(removedBeforeReturn).toEqual(removedKeys);
  expect(vi.mocked(post).mock.calls[0][1]).toEqual({ token: 'session-token' });
});

it('returns no URL when the caller does not ask to end the provider session', async () => {
  expect(await signOut()).toEqual({});
  expect(removedBeforeReturn).toEqual(removedKeys);
});

it('still removes the token and keys when the server cannot be reached', async () => {
  vi.mocked(post).mockRejectedValue(new Error('network-failure'));
  expect(await signOut({ endProviderSession: true })).toEqual({});
  expect(removedBeforeReturn).toEqual(removedKeys);
});

it('ignores a non-string URL from the server', async () => {
  vi.mocked(post).mockResolvedValue({ providerLogoutUrl: 42 });
  expect(await signOut({ endProviderSession: true })).toEqual({});
});

// fork: sc-2970, the URL carries the ID token as id_token_hint
it('never logs the provider logout URL', async () => {
  const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  expect(await signOut({ endProviderSession: true })).toEqual({
    providerLogoutUrl,
  });
  for (const log of logs) {
    expect(JSON.stringify(log.mock.calls)).not.toContain('client_id=c');
  }
});
