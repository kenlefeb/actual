import * as api from '@actual-app/api';
import { z } from 'zod';

import { Refusal } from '#refusal';
import { withText } from '#sanitize';
import { moneyAs } from '#tools/read/shared';
import type { RegisterTool } from '#tools/read/shared';

import { id, loggedWrite, requireAmount, requireMonth } from './shared';

const month = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM');

async function budgeted(m: string, categoryId: string) {
  const { categoryGroups } = await api.getBudgetMonth(m);
  const category = categoryGroups
    .flatMap(g => g.categories ?? [])
    .find(c => c.id === categoryId);
  if (!category) {
    throw new Refusal(
      'category_id must be the id of an existing category, never a name.',
    );
  }
  return { amount: Number(category.budgeted ?? 0), name: category.name };
}

export function registerBudgetWriteTools(tool: RegisterTool, auditLog: string) {
  tool(
    'write_set_budget_amount',
    "Set one category's budgeted amount for a month (YYYY-MM), by category id (never a name). Amounts are integer cents. Returns the amount before and after.",
    {
      month,
      category_id: id,
      amount: z.number(), // bounds: requireAmount, with fixed text
    },
    async ({ month: m, category_id, amount }) => {
      requireMonth(m);
      requireAmount(amount);
      const before = await budgeted(m, category_id);

      return loggedWrite(
        auditLog,
        'write_set_budget_amount',
        {
          ids: [category_id],
          changes: [
            {
              id: category_id,
              field: `budgeted:${m}`,
              before: before.amount,
              after: amount,
            },
          ],
        },
        async () => {
          await api.setBudgetAmount(m, category_id, amount);
          return { applied: [category_id] };
        },
        async () => {
          const after = await budgeted(m, category_id);
          return withText(
            {
              month: m,
              category_id,
              ...moneyAs('before', before.amount),
              ...moneyAs('after', after.amount),
            },
            { category: after.name },
          );
        },
      );
    },
  );
}
