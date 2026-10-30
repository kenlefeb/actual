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

  test('notes a paycheck schedule on its edit page', async () => {
    await page.setViewportSize({ width: 375, height: 600 });
    await navigation.goToSchedulesPage();
    await page.getByRole('button', { name: 'Add paycheck' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Acme');
    const gross = page.getByLabel('Gross pay');
    await gross.fill('3000');
    await gross.press('Enter');
    await page.getByLabel('New clearing account name').fill('Acme Paycheck');
    const depositAccount = page.getByLabel('Deposit 1 account');
    // pressSequentially + option click: fill()+Enter breaks the autocomplete
    await depositAccount.pressSequentially('Bank of America');
    await page
      .getByRole('option')
      .filter({ hasText: 'Bank of America' })
      .first()
      .click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByRole('button', { name: 'Add paycheck' }),
    ).toBeVisible();

    // The Schedules list hides a paycheck's schedules, so open one by its id
    const paySchedule = await page.evaluate(() => {
      const [query] = window.__TANSTACK_QUERY_CLIENT__
        .getQueryCache()
        .findAll({ queryKey: ['paychecks', 'lists'] });
      const [paycheck] = query.state.data as Array<{
        definition: { paySchedule: string };
      }>;
      return paycheck.definition.paySchedule;
    });
    await page.evaluate(
      id => window.__navigate(`/schedules/${id}`),
      paySchedule,
    );

    const note = page.getByRole('note');
    await expect(note).toContainText('Part of paycheck "Acme"');
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
    await expect(note).toMatchThemeScreenshots();

    await note.getByRole('button', { name: 'Edit paycheck' }).click();
    await expect(
      page.getByRole('heading', { name: 'Edit paycheck' }),
    ).toBeVisible();
  });
});
