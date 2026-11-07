import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { startOpenIdProvider } from './fixtures/openid-provider';
import type { OpenIdProvider } from './fixtures/openid-provider';
import { startSyncServer } from './fixtures/sync-server';
import type { SyncServer } from './fixtures/sync-server';
import { ConfigurationPage } from './page-models/configuration-page';

function requestsTo(provider: OpenIdProvider, pathname: string) {
  return provider.requests.filter(url => url.pathname === pathname);
}

async function signInWithOpenId(page: Page, provider: OpenIdProvider) {
  const before = requestsTo(provider, '/authorize').length;
  await page
    .getByRole('button', { name: /^(Start using|Sign in with) OpenID$/ })
    .click();
  // The stub approves at once and the server sends the browser back signed in
  await expect(
    page.getByText(`logged in as: ${provider.user.name}`),
  ).toBeVisible();
  expect(requestsTo(provider, '/authorize')).toHaveLength(before + 1);
}

// openid-true-sign-out tasks 4.1 and 4.2: the user menu's "Sign out" ends the
// provider session too, then returns to Actual's sign-in page.
// openid-logout-id-token-hint (sc-2970): it sends the ID token as
// id_token_hint, so the provider skips its confirmation page, and the client
// never logs the address that carries it.
export function describeOpenIdSignOut(viewport: {
  width: number;
  height: number;
}) {
  test.describe(`Sign out of an OpenID server at ${viewport.width}px`, () => {
    test.describe.configure({ mode: 'serial' });

    let provider: OpenIdProvider;
    let server: SyncServer;

    test.beforeAll(async () => {
      test.setTimeout(300_000);
      provider = await startOpenIdProvider();
      server = await startSyncServer(url => ({
        ACTUAL_OPENID_DISCOVERY_URL: provider.issuer,
        ACTUAL_OPENID_CLIENT_ID: provider.clientId,
        ACTUAL_OPENID_CLIENT_SECRET: provider.clientSecret,
        ACTUAL_OPENID_SERVER_HOSTNAME: url,
      }));
    });

    test.afterAll(async () => {
      server?.stop();
      await provider?.stop();
    });

    test('leaves the provider, returns to sign-in, and signs in again', async ({
      browser,
      baseURL,
    }) => {
      const page = await browser.newPage({ viewport });
      const consoleMessages: string[] = [];
      page.on('console', message => consoleMessages.push(message.text()));
      // In production the sync server serves the app, so the provider's return
      // URL (the server's root) is the app. Here the app runs on the e2e web
      // server, so send the server's root there, as that shared origin would.
      await page.route(`${server.url}/`, route =>
        route.fulfill({ status: 302, headers: { location: `${baseURL}/` } }),
      );
      try {
        await page.goto('/');
        await new ConfigurationPage(page).clickOnConnectServer();
        await page.getByPlaceholder('https://example.com').fill(server.url);
        await page.getByRole('button', { name: 'Connect' }).click();
        await signInWithOpenId(page, provider);

        await page.getByRole('button', { name: 'Server online' }).click();
        await page
          .getByRole('menu')
          .getByRole('button', { name: 'Sign out' })
          .click();

        // Back on Actual's sign-in page, after the provider's end-session page
        const signIn = page.getByRole('button', {
          name: 'Sign in with OpenID',
        });
        await expect(signIn).toBeVisible();
        const logouts = requestsTo(provider, '/logout');
        expect(logouts).toHaveLength(1);
        expect(logouts[0].searchParams.get('post_logout_redirect_uri')).toBe(
          `${server.url}/`,
        );
        expect(logouts[0].searchParams.get('client_id')).toBe(
          provider.clientId,
        );
        const issued = provider.idTokens.get(provider.user.sub);
        expect(issued).toBeTruthy();
        expect(logouts[0].searchParams.get('id_token_hint')).toBe(issued);
        expect(
          consoleMessages.filter(text => issued && text.includes(issued)),
        ).toEqual([]);

        // The next sign-in goes back through the provider's authorize page
        await signInWithOpenId(page, provider);
      } finally {
        await page.close();
      }
    });
  });
}
