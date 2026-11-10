import type { Page } from '@playwright/test';
import axe from 'axe-core';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { MobileNavigation } from './page-models/mobile-navigation';

// Every role=option row wraps its row button (upstream), so axe still reports
// nested-interactive on the options. The fork's part is that no tag or link sits
// inside a <button>, and that no flagged node is a button.
// Other findings (color-contrast, landmark-unique) are tracked as bug stories.
async function checkList(page: Page) {
  await page.evaluate(axe.source);
  return page.evaluate(async () => {
    const list = document.querySelector('[aria-label="Transaction list"]')!;
    // @ts-expect-error axe is injected by the evaluate call above
    const results = await window.axe.run(list);
    const nested = results.violations.find(
      (v: { id: string }) => v.id === 'nested-interactive',
    );
    const flaggedButtons: string[] = (nested?.nodes ?? [])
      .map((n: { target: string[] }) => document.querySelector(n.target[0])!)
      .filter((el: Element) => el.closest('button'))
      .map((el: Element) => el.outerHTML.slice(0, 120));
    const nestedControls = [
      ...list.querySelectorAll('[data-note-interactive], a'),
    ]
      .filter(el => el.closest('button'))
      .map(el => el.outerHTML.slice(0, 120));
    return { flaggedButtons, nestedControls };
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

  test('a single account list has no tag or link inside a button', async () => {
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
    expect(await checkList(page)).toEqual({
      flaggedButtons: [],
      nestedControls: [],
    });
  });

  test('the all accounts list has no tag or link inside a button', async () => {
    await page.goto('/accounts/all');
    await page.getByPlaceholder(/^Search/).fill('Hotel');
    const list = page.getByLabel('Transaction list');
    await expect(
      list.getByRole('button', { name: 'Filter by #vacation', exact: true }),
    ).toBeVisible();
    expect(await checkList(page)).toEqual({
      flaggedButtons: [],
      nestedControls: [],
    });
  });
});
