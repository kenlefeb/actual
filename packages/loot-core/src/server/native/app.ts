// Fork-only (sc-3584, ADR 11). Batched reads for native Apple screens: one
// message returns a whole view's numbers, so the native bridge never reads
// cells one by one. Read-only; the contract is in app.test.ts and its
// fixtures, which the Swift tests decode too.
import { createApp } from '#server/app';
import { aqlQuery } from '#server/aql';
import { getBudgetType } from '#server/budget/base';
import * as sheet from '#server/sheet';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import type { CategoryEntity, CategoryGroupEntity } from '#types/models';

// null: the value doesn't apply to this budget type (or row)
type Amount = number | null;

export type NativeBudgetMonthCategory = {
  id: string;
  name: string;
  hidden: boolean;
  budgeted: Amount;
  spent: Amount;
  balance: Amount;
  carryover: boolean;
};

export type NativeBudgetMonthGroup = {
  id: string;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  budgeted: Amount;
  spent: Amount;
  balance: Amount;
  categories: NativeBudgetMonthCategory[];
};

export type NativeBudgetMonth = {
  month: string;
  budgetType: 'envelope' | 'tracking';
  totals: {
    budgeted: Amount;
    spent: Amount;
    income: Amount;
    balance: Amount;
    // envelope only
    toBudget: Amount;
    available: Amount;
    lastMonthOverspent: Amount;
    forNextMonth: Amount;
    fromLastMonth: Amount;
    // tracking only
    budgetedIncome: Amount;
    saved: Amount;
  };
  groups: NativeBudgetMonthGroup[];
};

export type NativeHandlers = {
  'native/budget-month': typeof budgetMonth;
};

export const app = createApp<NativeHandlers>();
app.method('native/budget-month', budgetMonth);

async function budgetMonth({
  month,
}: {
  month: string;
}): Promise<NativeBudgetMonth> {
  const sheetName = /^\d{4}-\d{2}$/.test(month)
    ? monthUtils.sheetForMonth(month)
    : null;
  if (!sheetName || cell(sheetName, 'total-budgeted') === null) {
    throw new Error(`native/budget-month: no budget for month ${month}`);
  }
  const amount = (name: string): Amount => {
    const value = cell(sheetName, name);
    // An uncomputed cell holds '', which the web UI shows as 0
    return value === null ? null : typeof value === 'number' ? value : 0;
  };
  const isEnvelope = getBudgetType() !== 'tracking';
  const envelope = (name: string) => (isEnvelope ? amount(name) : null);
  const tracking = (name: string) => (isEnvelope ? null : amount(name));

  const { data: groups } = (await aqlQuery(
    q('category_groups').select('*'),
  )) as { data: CategoryGroupEntity[] };

  return {
    month,
    budgetType: isEnvelope ? 'envelope' : 'tracking',
    totals: {
      budgeted: amount('total-budgeted'),
      spent: amount('total-spent'),
      income: amount('total-income'),
      balance: amount('total-leftover'),
      toBudget: envelope('to-budget'),
      available: envelope('available-funds'),
      lastMonthOverspent: envelope('last-month-overspent'),
      forNextMonth: envelope('buffered'),
      fromLastMonth: envelope('from-last-month'),
      budgetedIncome: tracking('total-budget-income'),
      saved: tracking('total-saved'),
    },
    groups: groups.map(group => ({
      id: group.id,
      name: group.name,
      isIncome: Boolean(group.is_income),
      hidden: Boolean(group.hidden),
      budgeted: amount(`group-budget-${group.id}`),
      spent: amount(`group-sum-amount-${group.id}`),
      balance: amount(`group-leftover-${group.id}`),
      categories: (group.categories ?? []).map((cat: CategoryEntity) => ({
        id: cat.id,
        name: cat.name,
        hidden: Boolean(cat.hidden),
        budgeted: amount(`budget-${cat.id}`),
        spent: amount(`sum-amount-${cat.id}`),
        balance: amount(`leftover-${cat.id}`),
        carryover: Boolean(cell(sheetName, `carryover-${cat.id}`)),
      })),
    })),
  };
}

// null: the cell doesn't exist for this budget type or row
function cell(sheetName: string, name: string) {
  return sheet.get().getCellValueLoose(sheetName, name) ?? null;
}
