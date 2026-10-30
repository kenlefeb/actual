// Scenarios from openspec/changes/move-on-budget-moved-history: the filter the
// uncategorized count and lists use, run against a real database
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { loadRules } from '#server/transactions/transaction-rules';
import { isMovedHistory, notMovedHistoryFilter } from '#shared/moved-history';
import { q } from '#shared/query';

import { app } from './app';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
});

async function uncategorizedIds() {
  const { data } = (await aqlQuery(
    q('transactions')
      .filter({
        'account.offbudget': false,
        category: null,
        is_parent: false,
        ...notMovedHistoryFilter('account'),
      })
      .select('id'),
  )) as { data: Array<{ id: string }> };
  return data.map(row => row.id).sort();
}

describe('notMovedHistoryFilter', () => {
  it('moved history is excluded, later and never-moved are kept', async () => {
    await db.insertAccount({ id: 'checking', name: 'Checking', offbudget: 0 });
    await db.insertAccount({ id: 'vanguard', name: 'Vanguard', offbudget: 1 });
    for (const [id, account, date] of [
      ['c1', 'checking', '2016-11-01'],
      ['c2', 'checking', '2016-12-05'],
      ['v-old', 'vanguard', '2016-11-15'],
      ['v-new', 'vanguard', '2016-12-05'],
      ['v-offset', 'vanguard', '2016-12-01'],
    ]) {
      await db.insertTransaction({ id, account, date, amount: 100 });
    }
    await app.handlers['account-move-on-budget']({
      id: 'vanguard',
      startDate: '2016-12-01',
    });
    const offset = (
      await db.first<{ budget_start_offset: string }>(
        "SELECT budget_start_offset FROM accounts WHERE id = 'vanguard'",
      )
    )?.budget_start_offset;

    const ids = await uncategorizedIds();

    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
    expect(ids).toContain('v-new');
    expect(ids).not.toContain('v-old');
    expect(ids).not.toContain(offset);
  });
});

describe('isMovedHistory', () => {
  const account = {
    budget_start_date: '2016-12-01',
    budget_start_offset: 'off',
  };
  it.each([
    [{ id: 'a', date: '2016-11-30' }, account, true],
    [{ id: 'a', date: '2016-12-01' }, account, false],
    [{ id: 'off', date: '2016-12-01' }, account, true],
    [{ id: 'a', date: '2000-01-01' }, { budget_start_date: null }, false],
    [{ id: 'a', date: '2000-01-01' }, undefined, false],
  ])('%j', (transaction, acct, expected) => {
    expect(isMovedHistory(transaction as never, acct as never)).toBe(expected);
  });
});
