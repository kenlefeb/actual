import { describe, expect, it } from 'vitest';

import { accountFilter, uncategorizedTransactions } from '.';

// The filter's behaviour is covered in loot-core (moved-history-filter.test.ts);
// these keep the uncategorized queries wired to it.
describe('uncategorized queries leave out moved history', () => {
  it.each([
    [
      'uncategorizedTransactions()',
      () => uncategorizedTransactions().serialize(),
    ],
    [
      "transactions('uncategorized')",
      () => ({ filterExpressions: [accountFilter('uncategorized')] }),
    ],
  ])('%s', (_name, build) => {
    const filters = JSON.stringify(build().filterExpressions);
    expect(filters).toContain('account.budget_start_date');
    expect(filters).toContain('account.budget_start_offset');
  });
});
