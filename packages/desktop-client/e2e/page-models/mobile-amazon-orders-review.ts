import { join } from 'path';

import type { Locator, Page } from '@playwright/test';

// loot-core's synthetic export, read by path so a layout change there updates
// this test too
const FIXTURE = join(
  __dirname,
  '../../../loot-core/src/server/amazon-orders/__fixtures__/order-history.csv',
);

export class MobileAmazonOrdersReview {
  readonly page: Page;
  readonly dialog: Locator;
  readonly applyAllButton: Locator;
  readonly undoButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByTestId('import-amazon-orders-modal');
    this.applyAllButton = this.dialog.getByRole('button', {
      name: /^Apply all/,
    });
    this.undoButton = this.dialog.getByRole('button', { name: 'Undo' });
  }

  // Opens All Accounts → "Import Amazon orders" and picks the fixture
  async open() {
    await this.page.evaluate(() => window.__navigate?.('/accounts/all'));
    await this.page.getByRole('button', { name: 'All Accounts' }).click();
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.page
      .getByRole('button', { name: 'Import Amazon orders' })
      .click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(FIXTURE);
    await this.dialog.waitFor();
  }

  // An order can ship more than once, so name an item to pick one shipment
  card(orderId: string, item?: string) {
    const cards = this.dialog.getByTestId(`amazon-charge-${orderId}`);
    return item ? cards.filter({ hasText: item }) : cards;
  }

  async apply(card: Locator) {
    await card.getByRole('button', { name: 'Apply' }).click();
  }
}
