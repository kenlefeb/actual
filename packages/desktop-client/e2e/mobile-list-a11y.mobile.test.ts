import type { Page } from '@playwright/test';
import axe from 'axe-core';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { MobileNavigation } from './page-models/mobile-navigation';

// Other findings (color-contrast, landmark-unique) are tracked as bug stories.
async function runAxe(page: Page) {
  await page.evaluate(axe.source);
  return page.evaluate(async () => {
    // @ts-expect-error axe is injected by the evaluate call above
    const results = await window.axe.run(
      document.querySelector('[aria-label="Transaction list"]'),
    );
    return results.violations.map((v: { id: string }) => v.id);
  });
}

test.describe('Mobile transaction list accessibility', () => {
  let page: Page;
  let navigation: MobileNavigation;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    navigation = new MobileNavigation(page);
    await page.setViewportSize({ width: 350, height: 600 });
    await page.goto('/');
    await new ConfigurationPage(page).createTestFile();

    // One transaction whose note has a tag and a link.
    const entry = await navigation.goToTransactionEntryPage();
    await entry.fillAmount('12.34');
    await entry.header.click();
    await entry.fillField(page.getByTestId('payee-field'), 'Kroger');
    await entry.fillField(page.getByTestId('category-field'), 'Clothing');
    await entry.fillField(page.getByTestId('account-field'), 'Ally Savings');
    await page
      .getByRole('textbox', { name: 'Notes' })
      .fill('Hotel #vacation https://example.com');
    await entry.header.click();
    await entry.createTransaction();
  });

  test.afterEach(async () => {
    await page?.close();
  });

  test('a single account list has no nested interactive controls', async () => {
    await page.goto('/accounts');
    await page
      .getByTestId('account-list-item')
      .filter({ hasText: 'Ally Savings' })
      .click();
    await page.getByPlaceholder(/^Search/).fill('Hotel');
    const list = page.getByLabel('Transaction list');
    await expect(
      list.getByRole('button', { name: 'Filter by #vacation', exact: true }),
    ).toBeVisible();
    expect(await runAxe(page)).not.toContain('nested-interactive');
  });

  test('the all accounts list has no nested interactive controls', async () => {
    await page.goto('/accounts/all');
    await page.getByPlaceholder(/^Search/).fill('Hotel');
    const list = page.getByLabel('Transaction list');
    await expect(
      list.getByRole('button', { name: 'Filter by #vacation', exact: true }),
    ).toBeVisible();
    expect(await runAxe(page)).not.toContain('nested-interactive');
  });
});
