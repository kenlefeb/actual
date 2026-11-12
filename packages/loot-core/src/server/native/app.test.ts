import { app as budgetApp } from '#server/budget/app';
import { createBudget } from '#server/budget/base';
// Fork-only (sc-3584). The contract for the native bridge: the Swift tests in
// packages/mobile-client/ios/NativeBridge decode the same fixture files, so a
// shape change here fails both sides. Regenerate with `vitest -u`.
import * as db from '#server/db';
import * as prefs from '#server/prefs';
import * as sheet from '#server/sheet';
import { getCurrency } from '#shared/currencies';

import { app } from './app';

async function setPrefs(prefs: Record<string, string>) {
  for (const [id, value] of Object.entries(prefs)) {
    await db.insert('preferences', { id, value });
  }
}

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

  it('carries the web formatting preferences, JPY fixture', async () => {
    await createBudget(['2026-02', '2026-03']);
    await seedMonth();
    await setPrefs({
      defaultCurrencyCode: 'JPY',
      numberFormat: 'dot-comma',
      currencySymbolPosition: 'after',
      currencySpaceBetweenAmountAndSymbol: 'true',
    });
    const result = await budgetMonth('2026-03');
    expect(result).toMatchObject({
      currencyCode: 'JPY',
      currencyDecimalPlaces: 0,
      currencySymbol: '¥',
      currencySymbolPosition: 'after',
      currencySpace: true,
      numberFormat: 'dot-comma',
      hideFraction: false,
    });
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/budget-month-envelope-jpy.json',
    );
  });

  it('uses the web defaults when no formatting is set', async () => {
    await createBudget(['2026-02', '2026-03']);
    expect(await budgetMonth('2026-03')).toMatchObject({
      currencyCode: '',
      currencyDecimalPlaces: 2,
      currencySymbol: '',
      currencySymbolPosition: 'before',
      currencySpace: false,
      numberFormat: 'comma-dot',
      hideFraction: false,
    });
  });

  it('carries hideFraction and a symbol like the web table', async () => {
    await createBudget(['2026-02', '2026-03']);
    await setPrefs({ defaultCurrencyCode: 'CAD', hideFraction: 'true' });
    expect(await budgetMonth('2026-03')).toMatchObject({
      currencyCode: 'CAD',
      currencySymbol: getCurrency('CAD').symbol,
      hideFraction: true,
    });
  });

  it('falls back like the web for an unknown or invalid preference', async () => {
    await createBudget(['2026-02', '2026-03']);
    await setPrefs({
      defaultCurrencyCode: 'ZZZ',
      numberFormat: 'nonsense',
      currencySymbolPosition: 'sideways',
    });
    expect(await budgetMonth('2026-03')).toMatchObject({
      currencyCode: '',
      currencySymbol: '',
      currencyDecimalPlaces: 2,
      numberFormat: 'comma-dot',
      currencySymbolPosition: 'before',
    });
  });

  it('refuses a month outside the budget', async () => {
    await createBudget(['2026-02', '2026-03']);
    await expect(budgetMonth('1999-01')).rejects.toThrow(/1999-01/);
    await expect(budgetMonth('not-a-month')).rejects.toThrow(/not-a-month/);
  });
});

// native-bridge: "Setting a budgeted amount" (sc-3769). The edit is the web's
// own handler; the next native read shows it, and to-budget moves with it.
describe('budget/budget-amount then native/budget-month', () => {
  it('shows the new amount and the changed to-budget on the next read', async () => {
    await createBudget(['2026-02', '2026-03']);
    await seedMonth();
    const before = await budgetMonth('2026-03');

    await budgetApp.handlers['budget/budget-amount']({
      category: 'rent',
      month: '2026-03',
      amount: 125000,
    });
    await sheet.waitOnSpreadsheet();

    const after = await budgetMonth('2026-03');
    const rent = (m: typeof before) =>
      m.groups.flatMap(g => g.categories).find(c => c.id === 'rent');
    expect(rent(before)?.budgeted).toBe(150000);
    expect(rent(after)?.budgeted).toBe(125000);
    expect(after.totals.toBudget).toBe((before.totals.toBudget ?? 0) + 25000);
  });
});
