import * as db from '#server/db';
import * as monthUtils from '#shared/months';
import { safeNumber } from '#shared/util';

import {
  getBudget,
  getBudgetData,
  getBudgetTable,
  getCategoryAverage,
  isTrackingBudget,
} from './actions';

/** One budget cell an action would change, as the app's own action would set it. */
export type BudgetCellPlan = {
  categoryId: string;
  month: string;
  before: number;
  after: number;
};

function changes(
  month: string,
  wanted: Array<{ categoryId: string; after: number }>,
): BudgetCellPlan[] {
  return wanted
    .map(({ categoryId, after }) => ({
      categoryId,
      month,
      before: getBudget({ category: categoryId, month }),
      after,
    }))
    .filter(cell => cell.after !== cell.before);
}

/**
 * The cells `copyPreviousMonth` would change, without writing: the same
 * categories (not hidden, not income in an envelope budget), the same values.
 */
export async function planCopyPreviousMonth({
  month,
}: {
  month: string;
}): Promise<BudgetCellPlan[]> {
  const previous = monthUtils.prevMonth(month).replace('-', '');
  const rows = await getBudgetData(getBudgetTable(), previous);
  return changes(
    month,
    rows
      .filter(
        r =>
          !(r.is_income === 1 && !isTrackingBudget()) &&
          r.hidden !== 1 &&
          r.group_hidden !== 1,
      )
      .map(r => ({
        categoryId: r.category,
        after: safeNumber(typeof r.amount === 'number' ? r.amount : 0),
      })),
  );
}

/**
 * The cells the 3, 6 or 12 month average action (`setNMonthAvg`) would change,
 * without writing: spending averaged over the months with activity, as a
 * positive budget for an expense.
 */
export async function planAverage({
  month,
  months,
}: {
  month: string;
  months: number;
}): Promise<BudgetCellPlan[]> {
  const categories = await db.all<db.DbViewCategoryWithGroupHidden>(
    `
  SELECT c.*
  FROM categories c
  LEFT JOIN category_groups g ON c.cat_group = g.id
  WHERE c.tombstone = 0 AND c.hidden = 0 AND g.hidden = 0
  `,
  );
  const wanted: Array<{ categoryId: string; after: number }> = [];
  for (const cat of categories) {
    if (cat.is_income === 1 && !isTrackingBudget()) continue;
    const average = await getCategoryAverage({
      month,
      maxMonths: months,
      categoryId: cat.id,
    });
    // `|| 0` turns -0 into 0
    wanted.push({
      categoryId: cat.id,
      after: (cat.is_income === 0 ? -average : average) || 0,
    });
  }
  return changes(month, wanted);
}
