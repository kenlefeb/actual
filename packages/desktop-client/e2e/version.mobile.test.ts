import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';

const { version } = JSON.parse(
  readFileSync(path.join(__dirname, '../package.json'), 'utf8'),
);

test('Settings displays the customized client version', async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: 'Actual private version acceptance',
  });
  try {
    await page.goto('/');
    await new ConfigurationPage(page).importBudget(
      'Actual',
      'e2e/fixtures/mobile-receipts.zip',
    );
    await expect(page.getByRole('status')).toHaveText(
      'Local file — not syncing',
    );
    // On phones /settings is a menu; the version is under General
    await page.goto('/settings/general');
    await expect(
      page.getByText('Client version', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(`v${version}`, { exact: true })).toBeVisible();
  } finally {
    await page.close();
  }
});
