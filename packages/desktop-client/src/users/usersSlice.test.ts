import type { Mock } from 'vitest';

const mocked: { send: Mock } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@actual-app/core/platform/client/connection', async () => ({
  ...(await import('#mocks/connection')),
  send: mocked.send,
}));

// The automatic callers (session expiry in sync-events.ts, ConfigServer.tsx,
// App.tsx and the admin pages) dispatch signOut() with no argument.
it('an automatic sign-out never asks for or follows the provider logout', async () => {
  vi.resetModules();
  const { configureTestAppStore, createTestQueryClient } =
    await import('#mocks');
  const { signOut } = await import('./usersSlice');
  mocked.send.mockImplementation(async (name: string) =>
    name === 'subscribe-sign-out'
      ? { providerLogoutUrl: 'https://identity.example/oidc/logout' }
      : undefined,
  );
  const assign = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    assign,
  });
  const openURLInBrowser = vi.fn();
  window.Actual = { ...window.Actual, openURLInBrowser };

  const store = configureTestAppStore({ queryClient: createTestQueryClient() });
  await store.dispatch(signOut());

  const signOutCalls = mocked.send.mock.calls.filter(
    ([name]) => name === 'subscribe-sign-out',
  );
  expect(signOutCalls).toHaveLength(1);
  expect(signOutCalls[0][1]?.endProviderSession).not.toBe(true);
  expect(assign).not.toHaveBeenCalled();
  expect(openURLInBrowser).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
