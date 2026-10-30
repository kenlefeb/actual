import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { MobileBudgetPage } from './page-models/mobile-budget-page';

test('mobile note retains document boundaries and opens a receipt without entering the editor', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.context().route('https://example.com/receipt.pdf', route =>
      route.fulfill({
        contentType: 'text/plain',
        body: 'Synthetic receipt link target',
      }),
    );
    await page.goto('/');
    await new ConfigurationPage(page).importBudget(
      'Actual',
      'e2e/fixtures/mobile-receipts.zip',
    );
    // The imported budget opens on the budget page once it has loaded
    await new MobileBudgetPage(page).waitFor({ timeout: 30_000 });
    await page.goto('/accounts/7b57c309-c7e9-48b1-bb28-7e3362951ab5');
    const item = page
      .getByRole('option')
      .filter({ hasText: 'Synthetic Mixed Purchase' });
    await expect(page.getByTestId('transactions-balance')).toHaveText('901.00');
    await item.click();
    const note =
      'MOBILE RECEIPT CHECK\nRef 12345\nhttps://example.com/receipt.pdf';
    const notes = page
      .getByRole('textbox', { name: 'Notes', exact: true })
      .last();
    await notes.fill(note);
    await page.getByRole('heading', { name: 'Split', exact: true }).click();
    const preview = page.getByRole('link', {
      name: 'https://example.com/receipt.pdf',
      exact: true,
    });
    await expect(preview).toHaveAttribute(
      'href',
      'https://example.com/receipt.pdf',
    );
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await item.click();
    await expect(notes).toHaveValue(note);
    await expect(
      page.getByRole('textbox', { name: 'Notes', exact: true }).nth(0),
    ).toHaveValue('Groceries #Alex #Sam');
    await expect(
      page.getByRole('textbox', { name: 'Notes', exact: true }).nth(1),
    ).toHaveValue('Software #Alex #Jordan');
    const softwareNote = 'Software #Alex #Jordan\nSPLIT PHONE CHECK';
    await page
      .getByRole('textbox', { name: 'Notes', exact: true })
      .nth(1)
      .fill(softwareNote);
    await page.getByRole('heading', { name: 'Split', exact: true }).click();
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await item.click();
    await expect(notes).toHaveValue(note);
    await expect(
      page.getByRole('textbox', { name: 'Notes', exact: true }).nth(0),
    ).toHaveValue('Groceries #Alex #Sam');
    await expect(
      page.getByRole('textbox', { name: 'Notes', exact: true }).nth(1),
    ).toHaveValue(softwareNote);
    await expect(
      page.getByRole('textbox', { name: 'Notes', exact: true }).nth(1),
    ).toHaveJSProperty('tagName', 'TEXTAREA');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const listURL = page.url();
    const receipt = page.getByRole('link', {
      name: 'https://example.com/receipt.pdf',
      exact: true,
    });
    const popup = page.waitForEvent('popup');
    await receipt.click();
    const opened = await popup;
    await expect(opened).toHaveURL('https://example.com/receipt.pdf');
    expect(page.url()).toBe(listURL);
    await opened.close();
    await item.click();
    await expect(notes).toHaveValue(note);
  } finally {
    await page.close();
  }
});
