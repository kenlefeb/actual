import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';

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
    await expect(page.getByRole('status')).toHaveText(
      'Local file — not syncing',
    );
    await page.goto('/accounts/7b57c309-c7e9-48b1-bb28-7e3362951ab5');
    const item = page
      .getByRole('option')
      .filter({ hasText: 'Synthetic Mixed Purchase' });
    await expect(page.getByTestId('transactions-balance')).toHaveText('901.00');
    await item.click();
    const note =
      'MOBILE RECEIPT CHECK\nPAPERWORK:synthetic-id\nhttps://example.com/receipt.pdf';
    // Each Notes slot is the formatted group, or the textbox while editing
    const noteFields = page.locator(
      'textarea[aria-label="Notes"], [role="group"][aria-label="Notes"]',
    );
    const notes = noteFields.last();
    const leaveField = () =>
      page.getByRole('heading', { name: 'Split', exact: true }).click();
    const editNote = async (field: typeof notes, value: string) => {
      if ((await field.getAttribute('role')) === 'group') {
        await field.click({ position: { x: 2, y: 2 } });
      }
      await field.fill(value);
      await leaveField();
    };
    const expectNoteValue = async (field: typeof notes, value: string) => {
      if ((await field.getAttribute('role')) === 'group') {
        await field.click({ position: { x: 2, y: 2 } });
      }
      await expect(field).toHaveValue(value);
      await expect(field).toHaveJSProperty('tagName', 'TEXTAREA');
      await leaveField();
    };
    await editNote(notes, note);
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
    await expectNoteValue(notes, note);
    await expect(noteFields.nth(0)).toHaveText('Groceries #Alex #Sam');
    await expect(noteFields.nth(1)).toHaveText('Software #Alex #Jordan');
    const softwareNote = 'Software #Alex #Jordan\nSPLIT PHONE CHECK';
    await editNote(noteFields.nth(1), softwareNote);
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await item.click();
    await expectNoteValue(notes, note);
    await expect(noteFields.nth(0)).toHaveText('Groceries #Alex #Sam');
    await expectNoteValue(noteFields.nth(1), softwareNote);
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
    await expectNoteValue(notes, note);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    const parentNote = page
      .getByTestId('transaction-table')
      .getByTestId('notes')
      .filter({ hasText: 'MOBILE RECEIPT CHECK' });
    await parentNote.hover();
    await expect(page.getByRole('tooltip')).toContainText(
      'PAPERWORK:synthetic-id',
    );
    await parentNote.click();
    const desktopNote = page.getByRole('combobox', {
      name: 'Notes',
      exact: true,
    });
    await expect(desktopNote).toHaveValue(note);
    await desktopNote.press('Tab');
    await parentNote.click();
    await expect(desktopNote).toHaveValue(note);
    await desktopNote.press('End');
    await desktopNote.press('Shift+Enter');
    await desktopNote.pressSequentially('Desktop check');
    await desktopNote.press('Tab');
    await parentNote.click();
    await expect(desktopNote).toHaveValue(note + '\nDesktop check');
  } finally {
    await page.close();
  }
});
