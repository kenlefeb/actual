import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { MobileNavigation } from './page-models/mobile-navigation';

test.describe('Mobile paycheck editor', () => {
  let page: Page;
  let navigation: MobileNavigation;
  let configurationPage: ConfigurationPage;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    navigation = new MobileNavigation(page);
    configurationPage = new ConfigurationPage(page);

    await page.setViewportSize({ width: 350, height: 600 });
    await page.goto('/');
    await configurationPage.createTestFile();

    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Paychecks');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('opens the paycheck page from Schedules with net pay pinned', async () => {
    await navigation.goToSchedulesPage();
    await page.getByRole('button', { name: 'Add paycheck' }).click();

    await expect(
      page.getByRole('heading', { name: 'Add paycheck' }),
    ).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Acme');
    const gross = page.getByLabel('Gross pay');
    await gross.fill('3000');
    await gross.press('Enter');

    const netPay = page.getByText('Net pay:');
    await expect(netPay).toBeInViewport();
    await expect(netPay.locator('..')).toContainText('3,000.00');

    const details = page.getByRole('button', { name: /^Details/ });
    await details.click();
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toContainText('Acme');
  });
});
