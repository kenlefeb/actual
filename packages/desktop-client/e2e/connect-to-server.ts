import type { Page } from '@playwright/test';

import { expect } from './fixtures';
import type { SyncServer } from './fixtures/sync-server';
import { ConfigurationPage } from './page-models/configuration-page';

// Connects a fresh browser page to the sync server and opens a new budget
export async function connectToServer(
  page: Page,
  server: SyncServer,
  { isPhone = true }: { isPhone?: boolean } = {},
) {
  await page.goto('/');
  const configurationPage = new ConfigurationPage(page);
  await configurationPage.clickOnConnectServer();
  await page.getByPlaceholder('https://example.com').fill(server.url);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByPlaceholder('Password', { exact: true }).fill('e2e-pass');
  await page.getByPlaceholder('Confirm password').fill('e2e-pass');
  await page.getByRole('button', { name: 'OK' }).click();
  await page
    .getByRole('heading', { name: 'Sign in to this Actual instance' })
    .waitFor();
  await page.getByPlaceholder('Password', { exact: true }).fill('e2e-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Start budgeting' }).click();
  if (isPhone) {
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.getByRole('status')).not.toHaveText(
      'Local file — not syncing',
    );
  } else {
    await expect(page.getByText('Server online')).toBeVisible();
  }
}
