import type { Page } from '@playwright/test';

import { connectToServer } from './connect-to-server';
import { expect, test } from './fixtures';
import { startSyncServer } from './fixtures/sync-server';
import type { SyncServer } from './fixtures/sync-server';
import { ConfigurationPage } from './page-models/configuration-page';
import { MobileAccountPage } from './page-models/mobile-account-page';
import { MobileTransactionEntryPage } from './page-models/mobile-transaction-entry-page';

// Synthetic: a PDF header and a minimal body, no real document
const pdf = {
  name: 'synthetic-invoice.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  ),
};

const phone = { width: 390, height: 844 };

// One account with one transaction; returns their ids
async function addTransaction(page: Page) {
  return page.evaluate(async () => {
    const account = (await window.$send('account-create', {
      name: 'Synthetic Checking',
    })) as string;
    const id = crypto.randomUUID();
    await window.$send('transaction-add', {
      id,
      account,
      date: new Date().toISOString().slice(0, 10),
      amount: -1234,
      notes: 'Synthetic purchase',
    });
    return { account, id };
  });
}

test.describe('Transaction documents on the phone', () => {
  test.describe.configure({ mode: 'serial' });

  let server: SyncServer;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    server = await startSyncServer();
  });

  test.afterAll(() => server?.stop());

  test('attach, see, open, remove and undo with a sync server', async ({
    browser,
  }) => {
    const page = await browser.newPage({ viewport: phone });
    try {
      await connectToServer(page, server);

      const { account, id } = await addTransaction(page);
      await page.goto(`/transactions/${id}`);
      const entry = new MobileTransactionEntryPage(page);
      await entry.waitFor();

      // Attach a PDF from Files on the phone
      await entry.attachDocument(pdf);

      // Paperclip on a phone row
      await page.goto(`/accounts/${account}`);
      const row = page
        .getByRole('option')
        .filter({ hasText: 'Synthetic purchase' });
      await expect(row.getByLabel('Has attached documents')).toBeVisible();

      // Open a PDF on the phone
      await row.click();
      await entry.openDocument(pdf.name);
      const viewer = page.getByTestId('transaction-attachment-viewer-modal');
      await expect(viewer.locator(`iframe[title="${pdf.name}"]`)).toBeVisible();
      await expect(
        viewer.getByText('Share or save', { exact: true }),
      ).toBeVisible();
      await expect(
        viewer.getByText('Use Share or save to see every page.'),
      ).toBeVisible();
      await viewer.getByRole('button', { name: 'Close' }).click();
      await expect(viewer).toBeHidden();

      // Remove on the phone
      await entry.removeDocument(pdf.name);
      await expect(entry.documentName(pdf.name)).toBeHidden();
      const notification = page.getByText('Document removed.');
      await expect(notification).toBeVisible();

      // Undo a removal on the phone
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(entry.documentName(pdf.name)).toBeVisible();
      await page.goto(`/accounts/${account}`);
      await expect(row).toBeVisible();
      await expect(row.getByLabel('Has attached documents')).toBeVisible();

      // Cancel while adding: a held document leaves nothing behind. The add
      // screen is opened from the account, so leaving it stays in the app.
      const accountPage = new MobileAccountPage(page);
      await page.goto(`/accounts/${account}`);
      await accountPage.clickCreateTransaction();
      await entry.waitFor();
      await entry.attachDocument(pdf);
      await page.getByRole('button', { name: 'Back' }).click();
      // The new row would show 0.00 (the amount isn't filled in)
      const newRow = accountPage.transactions.filter({ hasText: '0.00' });
      await expect(newRow).toHaveCount(0);

      // Add with a document: saved with the paperclip
      await accountPage.clickCreateTransaction();
      await entry.waitFor();
      await entry.attachDocument(pdf);
      await expect(entry.addTransactionButton).toBeEnabled();
      await entry.createTransaction();
      // The add screen closes and the new row is listed before its paperclip
      await expect(entry.addTransactionButton).toBeHidden();
      await expect(newRow).toHaveCount(1);
      await expect(newRow.getByLabel('Has attached documents')).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('Local-only budget on the phone', async ({ browser }) => {
    const page = await browser.newPage({ viewport: phone });
    try {
      await page.goto('/');
      await new ConfigurationPage(page).importBudget(
        'Actual',
        'e2e/fixtures/mobile-receipts.zip',
      );
      await expect(page.getByRole('status')).toHaveText(
        'Local file — not syncing',
      );
      await page.goto('/accounts/7b57c309-c7e9-48b1-bb28-7e3362951ab5');
      await page
        .getByRole('option')
        .filter({ hasText: 'Synthetic Mixed Purchase' })
        .click();
      let isPickerOpened = false;
      page.on('filechooser', () => {
        isPickerOpened = true;
      });

      await page.getByRole('button', { name: 'Attach document' }).click();

      await expect(
        page.getByText('Attaching documents needs a sync server.'),
      ).toBeVisible();
      expect(isPickerOpened).toBe(false);
    } finally {
      await page.close();
    }
  });
});
