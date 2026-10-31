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

  // Saves a paycheck and opens its pay schedule's edit page at phone width
  async function openPaySchedule() {
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
    return page.getByRole('note');
  }

  test('notes a paycheck schedule on its edit page', async () => {
    const note = await openPaySchedule();
    await expect(note).toContainText('Part of paycheck "Acme"');
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
    await expect(note).toMatchThemeScreenshots();

    await note.getByRole('button', { name: 'Edit paycheck' }).click();
    await expect(
      page.getByRole('heading', { name: 'Edit paycheck' }),
    ).toBeVisible();
  });

  test('keeps long year-to-date rows above the paycheck buttons', async () => {
    const note = await openPaySchedule();
    await note.getByRole('button', { name: 'Edit paycheck' }).click();
    await expect(
      page.getByRole('heading', { name: 'Edit paycheck' }),
    ).toBeVisible();

    // Let the real (empty) year-to-date fetch finish first, or it could land
    // after the seed below and replace it
    await expect(
      page.getByText('No paychecks posted this year or last year.'),
    ).toBeVisible();

    // The test budget has no posted pay, so seed 12 deductions of year-to-date,
    // and keep the seed from being refetched
    await page.evaluate(async () => {
      const client = window.__TANSTACK_QUERY_CLIENT__;
      const queryKey = ['paychecks', 'year-to-date'];
      client.setQueryDefaults(queryKey, { staleTime: Infinity });
      await client.cancelQueries({ queryKey });
      const [query] = client.getQueryCache().findAll({ queryKey });
      client.setQueryData(
        query.queryKey,
        [2025, 2026].map(year => ({
          year,
          gross: 300000,
          deductions: Array.from({ length: 12 }, (_, n) => ({
            name: `Deduction ${n + 1}`,
            amount: 1000,
          })),
          net: 200000,
        })),
      );
    });

    const table = page.getByRole('table', { name: 'Year to date' });
    const skip = page.getByRole('button', { name: 'Skip next paycheck' });
    await expect(table.getByRole('row')).toHaveCount(15);
    await skip.scrollIntoViewIfNeeded();

    const tableBox = await table.boundingBox();
    const skipBox = await skip.boundingBox();
    expect(tableBox!.y + tableBox!.height).toBeLessThanOrEqual(skipBox!.y);
    await expect(page).toMatchThemeScreenshots();
  });
});
