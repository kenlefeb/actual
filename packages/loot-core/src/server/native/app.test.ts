import { createBudget } from '#server/budget/base';
// Fork-only (sc-3584). The contract for the native bridge: the Swift tests in
// packages/mobile-client/ios/NativeBridge decode the same fixture files, so a
// shape change here fails both sides. Regenerate with `vitest -u`.
import * as db from '#server/db';
import * as prefs from '#server/prefs';
import * as sheet from '#server/sheet';

import { app } from './app';

const budgetMonth = (month: string) =>
  app.handlers['native/budget-month']({ month });

beforeEach(global.emptyDatabase());

beforeEach(async () => {
  global.currentMonth = '2026-03';
  await sheet.loadSpreadsheet(db);
  await prefs.loadPrefs();

  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  await db.insertCategory({
    id: 'salary',
    name: 'Salary',
    cat_group: 'income',
    is_income: 1,
  });
  await db.insertCategoryGroup({ id: 'bills', name: 'Bills' });
  await db.insertCategory({ id: 'rent', name: 'Rent', cat_group: 'bills' });
  await db.insertCategory({
    id: 'power',
    name: 'Power',
    cat_group: 'bills',
    hidden: 1,
  });
  await db.insertAccount({ id: 'checking', name: 'Checking' });
});

afterEach(() => {
  global.currentMonth = null;
});

async function seedMonth() {
  await db.insertTransaction({
    id: 'pay',
    date: '2026-03-01',
    account: 'checking',
    amount: 300000,
    category: 'salary',
  });
  await db.insertTransaction({
    id: 'rent-paid',
    date: '2026-03-02',
    account: 'checking',
    amount: -120000,
    category: 'rent',
  });
  sheet.get().set('budget202603!budget-rent', 150000);
  sheet.get().set('budget202603!budget-power', 10000);
  await sheet.waitOnSpreadsheet();
}

describe('native/budget-month', () => {
  it('envelope budget matches the contract fixture', async () => {
    await createBudget(['2026-02', '2026-03']);
    await seedMonth();

    const result = await budgetMonth('2026-03');

    expect(result.budgetType).toBe('envelope');
    expect(result.totals.toBudget).toBe(140000);
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/budget-month-envelope.json',
    );
  });

  it('tracking budget matches the contract fixture', async () => {
    sheet.get().meta().budgetType = 'tracking';
    await db.update('preferences', { id: 'budgetType', value: 'tracking' });
    await createBudget(['2026-02', '2026-03']);
    sheet.get().set('budget202603!budget-salary', 320000);
    await seedMonth();

    const result = await budgetMonth('2026-03');

    expect(result.budgetType).toBe('tracking');
    expect(result.totals.toBudget).toBeNull();
    expect(result.totals.budgetedIncome).toBe(320000);
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/budget-month-tracking.json',
    );
  });

  it('refuses a month outside the budget', async () => {
    await createBudget(['2026-02', '2026-03']);
    await expect(budgetMonth('1999-01')).rejects.toThrow(/1999-01/);
    await expect(budgetMonth('not-a-month')).rejects.toThrow(/not-a-month/);
  });
});
