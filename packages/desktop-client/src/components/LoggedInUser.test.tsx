import React from 'react';
import { MemoryRouter } from 'react-router';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

const env = vi.hoisted(() => ({
  electron: false,
  providerLogoutUrl: undefined as string | undefined,
  send: vi.fn(),
}));

vi.mock('@actual-app/core/platform/client/connection', async () => ({
  ...(await import('#mocks/connection')),
  send: env.send,
}));

vi.mock('@actual-app/core/shared/environment', async importActual => ({
  ...(await importActual<object>()),
  isElectron: () => env.electron,
}));

vi.mock('./ServerContext', () => ({
  useServerURL: () => 'https://actual.example',
  useMultiuserEnabled: () => false,
  useServerVersion: () => 'test',
}));

vi.mock('#auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: () => false }),
}));

const assign = vi.fn();
const openURLInBrowser = vi.fn();

// setupTests loads the store (and the real connection) before this file's
// mocks apply, so load the component and store fresh for each test.
async function load() {
  vi.resetModules();
  const { TestProviders } = await import('#mocks');
  const { LoggedInUser } = await import('./LoggedInUser');
  return { TestProviders, LoggedInUser };
}

beforeEach(() => {
  env.electron = false;
  env.providerLogoutUrl = undefined;
  sessionStorage.clear();
  assign.mockReset();
  openURLInBrowser.mockReset();
  env.send.mockReset().mockImplementation(async (name: string) => {
    if (name === 'subscribe-get-user') {
      return { offline: false, loginMethod: 'openid', userId: 'u' };
    }
    if (name === 'get-budgets' || name === 'get-remote-files') return [];
    if (name === 'subscribe-sign-out') {
      return env.providerLogoutUrl
        ? { providerLogoutUrl: env.providerLogoutUrl }
        : {};
    }
    return undefined;
  });
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    assign,
  });
  window.Actual = { ...window.Actual, openURLInBrowser };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function signOutFromMenu() {
  const { TestProviders, LoggedInUser } = await load();
  render(
    <TestProviders>
      <MemoryRouter>
        <LoggedInUser />
      </MemoryRouter>
    </TestProviders>,
  );
  await userEvent.click(await screen.findByText('Server online'));
  await userEvent.click(await screen.findByText('Sign out'));
  await waitFor(() =>
    expect(env.send).toHaveBeenCalledWith('subscribe-sign-out', {
      endProviderSession: true,
    }),
  );
  // Let the menu handler finish after the thunk resolves.
  await new Promise(resolve => setTimeout(resolve, 0));
}

it('sends the browser to the provider logout on web', async () => {
  env.providerLogoutUrl = 'https://identity.example/oidc/logout?client_id=c';
  await signOutFromMenu();
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith(
      'https://identity.example/oidc/logout?client_id=c',
    ),
  );
  expect(openURLInBrowser).not.toHaveBeenCalled();
});

// fork: sc-3103. The page the provider sends back must not join the
// SharedWorker coordinator, or it can hang on "Loading global preferences...".
it('tells the page coming back from the provider to start its own backend', async () => {
  env.providerLogoutUrl = 'https://identity.example/oidc/logout';
  await signOutFromMenu();
  await waitFor(() => expect(assign).toHaveBeenCalled());
  const { consumeProviderSignOut } = await import('#auth/providerSignOut');
  expect(consumeProviderSignOut()).toBe(true);
  expect(consumeProviderSignOut()).toBe(false);
});

it.each([
  ['Electron', 'https://identity.example/oidc/logout'],
  ['no provider logout', undefined],
])('leaves the next page load alone on %s', async (name, url) => {
  env.electron = name === 'Electron';
  env.providerLogoutUrl = url;
  await signOutFromMenu();
  const { consumeProviderSignOut } = await import('#auth/providerSignOut');
  expect(consumeProviderSignOut()).toBe(false);
});

// fork: sc-2970, the URL carries the ID token as id_token_hint
it('never logs the provider logout URL', async () => {
  env.providerLogoutUrl =
    'https://identity.example/oidc/logout?id_token_hint=secret.id.token';
  const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m =>
    vi.spyOn(console, m),
  );
  await signOutFromMenu();
  await waitFor(() => expect(assign).toHaveBeenCalled());
  for (const log of logs) {
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret.id.token');
  }
});

it('opens the provider logout in the system browser on Electron', async () => {
  env.electron = true;
  env.providerLogoutUrl = 'https://identity.example/oidc/logout';
  await signOutFromMenu();
  await waitFor(() =>
    expect(openURLInBrowser).toHaveBeenCalledWith(
      'https://identity.example/oidc/logout',
    ),
  );
  expect(assign).not.toHaveBeenCalled();
});

it('follows http only to a local development host', async () => {
  env.providerLogoutUrl = 'http://localhost:8080/logout';
  await signOutFromMenu();
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith('http://localhost:8080/logout'),
  );
});

it.each([
  undefined,
  // oxlint-disable-next-line no-script-url -- the URL the client must refuse
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,hi',
  'not a url',
  'http://identity.example/logout',
])('stays in Actual for %s', async url => {
  env.providerLogoutUrl = url;
  await signOutFromMenu();
  expect(assign).not.toHaveBeenCalled();
  expect(openURLInBrowser).not.toHaveBeenCalled();
});

// ManagementApp renders the budget-list user menu at every width, so the
// phone UI (and the mobile app, which runs this web build) gets "Sign out" too.
it.each([
  ['desktop', 1280],
  ['phone', 375],
])('the budget list shows "Sign out" at %s width', async (_, width) => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
  vi.resetModules();
  const { TestProviders } = await import('#mocks');
  const { ManagementApp } = await import('./manager/ManagementApp');
  const { useResponsive } =
    await import('@actual-app/components/hooks/useResponsive');
  let isNarrowWidth: boolean | undefined;
  function Probe() {
    ({ isNarrowWidth } = useResponsive());
    return null;
  }
  render(
    <TestProviders>
      <MemoryRouter>
        <Probe />
        <ManagementApp />
      </MemoryRouter>
    </TestProviders>,
  );
  // userEvent never settles over the whole manager page; a click is enough.
  fireEvent.click(await screen.findByText('Server online'));
  expect(await screen.findByText('Sign out')).toBeInTheDocument();
  expect(isNarrowWidth).toBe(width === 375);
});
