import { connectToServer } from './connect-to-server';
import { expect, test } from './fixtures';
import { startSyncServer } from './fixtures/sync-server';
import type { SyncServer } from './fixtures/sync-server';
import { AccountPage } from './page-models/account-page';

// Synthetic: a PDF header and a minimal body, no real document
const pdf = {
  name: 'synthetic-invoice.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  ),
};

test.describe('Transaction documents on desktop', () => {
  test.describe.configure({ mode: 'serial' });

  let server: SyncServer;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    server = await startSyncServer();
  });

  test.afterAll(() => server?.stop());

  test('add a transaction with a document, and cancel with one', async ({
    browser,
  }) => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    try {
      await connectToServer(page, server, { isPhone: false });
      const account = await page.evaluate(
        async () =>
          (await window.$send('account-create', {
            name: 'Synthetic Checking',
          })) as string,
      );
      await page.goto(`/accounts/${account}`);
      const accountPage = new AccountPage(page);
      await accountPage.waitFor();

      const newRow = page.getByTestId('new-transaction');
      const attachPdf = async () => {
        const fileChooser = page.waitForEvent('filechooser');
        await newRow.getByRole('button', { name: 'Attach document' }).click();
        await (await fileChooser).setFiles(pdf);
        await expect(
          newRow.getByTestId('pending-attachments').getByText(pdf.name),
        ).toBeVisible();
      };

      // Cancel while adding: the held document is dropped
      await accountPage.addNewTransactionButton.click();
      await attachPdf();
      await expect(newRow.getByTestId('pending-attachments-count')).toHaveText(
        '1',
      );
      await accountPage.cancelTransactionButton.click();
      await accountPage.addNewTransactionButton.click();
      await expect(newRow.getByTestId('pending-attachments')).toBeHidden();

      // Add with a document: saved with the paperclip, and the row is empty
      // The row is already open, so only the amount needs filling
      await accountPage._fillTransactionFields(accountPage.newTransactionRow, {
        debit: '12.34',
      });
      await attachPdf();
      await accountPage.addTransactionButton.click();
      await expect(
        accountPage.transactionTable.getByTestId('attachments-icon'),
      ).toBeVisible();
      await expect(newRow.getByTestId('pending-attachments')).toBeHidden();
    } finally {
      await page.close();
    }
  });
});
