import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { MobileAmazonOrdersReview } from './page-models/mobile-amazon-orders-review';
import { MobileNavigation } from './page-models/mobile-navigation';

// Adds the card transaction the fixture's $32.40 lamp shipment matches, and
// returns its id
async function addMatchingTransaction(page: Page) {
  return page.evaluate(async () => {
    const accounts = await window.$send('accounts-get');
    const account = accounts.find(a => !a.offbudget && !a.closed);
    if (!account) {
      throw new Error('Test budget has no open on-budget account');
    }
    const id = 'amazon-e2e-lamp';
    await window.$send('transaction-add', {
      id,
      account: account.id,
      date: '2026-11-06',
      amount: -3240,
      imported_payee: 'AMZN Mktp US',
    });
    return id;
  });
}

// A one-item shipment is itemized by annotating the transaction with the
// order link, not by splitting it
async function isItemized(page: Page, id: string) {
  return page.evaluate(async id => {
    const { data } = await window.$query(
      window.$q('transactions').filter({ id }).select(['notes']),
    );
    return String(data[0]?.notes ?? '').includes('orderID=111-0000001');
  }, id);
}

test.describe('Mobile Amazon order import', () => {
  let page: Page;
  let review: MobileAmazonOrdersReview;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await new ConfigurationPage(page).createTestFile();

    const settingsPage = await new MobileNavigation(page).goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Amazon order itemization');
    review = new MobileAmazonOrdersReview(page);
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('imports, applies and undoes a Matched charge on the phone', async () => {
    const id = await addMatchingTransaction(page);

    await review.open();

    // Order 111-0000001 shipped twice; the lamp is the $32.40 shipment
    const lamp = review.card('111-0000001', 'Example Lamp');
    await expect(lamp).toContainText('32.40');
    await expect(lamp).toContainText('AMZN Mktp US');
    await expect(lamp).toContainText('Example Lamp ×1');
    await expect(
      review.dialog.getByText(
        'Not matched: paid partly by gift card or points (1)',
      ),
    ).toBeVisible();
    await expect(review.card('111-0000002')).not.toContainText('Apply');

    await review.apply(lamp);
    await expect(lamp).toContainText('Applied');
    await expect.poll(() => isItemized(page, id)).toBe(true);

    await review.undoButton.click();
    await expect.poll(() => isItemized(page, id)).toBe(false);
    // Checked after the undo lands, so the review must stay open through it
    await expect(lamp.getByRole('button', { name: 'Apply' })).toBeVisible();
  });
});
