import * as api from '@actual-app/api';
import { z } from 'zod';

import type { Limits } from '#limits';
import { Refusal } from '#refusal';
import { withText } from '#sanitize';
import { moneyAs } from '#tools/read/shared';

import type { RegisterWriteTool } from './shared';
import {
  id,
  loggedWrite,
  requireAmount,
  requireCells,
  requireMonth,
  stderrLine,
} from './shared';

const month = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM');

export async function budgeted(m: string, categoryId: string) {
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

/** A month's budgeted amounts by category id (design D3: one read per month, not per cell). */
async function budgetedMonth(m: string) {
  const { categoryGroups } = await api.getBudgetMonth(m);
  return new Map(
    categoryGroups
      .flatMap(g => g.categories ?? [])
      .map(c => [c.id, { amount: Number(c.budgeted ?? 0), name: c.name }]),
  );
}

const NOT_A_CATEGORY =
  'category_id must be the id of an existing category, never a name.';

export function registerBudgetWriteTools(
  tool: RegisterWriteTool,
  limits: Limits,
) {
  tool(
    'write_set_budget_amount',
    "Set one category's budgeted amount for a month (YYYY-MM), by category id (never a name). Amounts are integer cents. Returns the amount before and after.",
    {
      month,
      category_id: id,
      amount: z.number(), // bounds: requireAmount, with fixed text
    },
    async ({ month: m, category_id, amount }, auditLog) => {
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
    { scopes: ['budget:write'] },
  );

  tool(
    'write_set_budget_amounts',
    `Set the budgeted amount of up to ${limits.maxCells} cells (a category in a month) in one call, by category id (never a name): cells is a list of {month (YYYY-MM), category_id, amount (integer cents)}. A cell may appear once. Every cell is checked first and a bad one refuses the whole call; then cells are written in order inside one write lock, each re-checked against the amount just read, and the call stops at the first cell that changed or that the engine fails on, naming applied, failed and not_written cells. Cells are named category_id:month in the audit log. Returns each cell's amount before and after. write_undo restores the applied cells.`,
    {
      cells: z
        .array(
          z
            .object({
              month,
              category_id: id,
              amount: z.number(), // bounds: requireAmount, with fixed text
            })
            .strict(),
        )
        .min(1)
        .max(limits.cellsCeiling),
    },
    async ({ cells }, auditLog) => {
      requireCells(auditLog, cells.length);
      const key = (c: { category_id: string; month: string }) =>
        `${c.category_id}:${c.month}`;
      if (new Set(cells.map(key)).size !== cells.length) {
        throw new Refusal(
          'A category and month may appear only once. Nothing changed.',
        );
      }
      for (const c of cells) {
        requireMonth(c.month);
        requireAmount(c.amount);
      }
      const months = new Map<
        string,
        Awaited<ReturnType<typeof budgetedMonth>>
      >();
      for (const m of new Set(cells.map(c => c.month))) {
        months.set(m, await budgetedMonth(m));
      }
      const plan = cells.map(c => {
        const before = months.get(c.month)!.get(c.category_id);
        if (!before) throw new Refusal(NOT_A_CATEGORY);
        return { ...c, key: key(c), before: before.amount };
      });

      return loggedWrite(
        auditLog,
        'write_set_budget_amounts',
        {
          ids: plan.map(c => c.key),
          changes: plan.map(c => ({
            id: c.category_id,
            field: `budgeted:${c.month}`,
            before: c.before,
            after: c.amount,
          })),
        },
        async callId => {
          const applied: string[] = [];
          let failed: string | undefined;
          let reason = '';
          // Not inside api.batchBudgetUpdates: a batch hides its own writes
          // from reads until it ends, which would make the re-check of the
          // next cell meaningless. Each cell is read, then written.
          for (const c of plan) {
            try {
              // The audited before must still hold when its cell is written
              const now = await budgeted(c.month, c.category_id);
              if (now.amount !== c.before) {
                failed = c.key;
                reason = 'changed';
                break;
              }
              await api.setBudgetAmount(c.month, c.category_id, c.amount);
              applied.push(c.key);
            } catch (error) {
              stderrLine(
                auditLog,
                `write_set_budget_amounts failed (call ${callId})`,
                error,
              );
              failed = c.key;
              reason = 'engine';
              break;
            }
          }
          return {
            applied,
            ...(failed ? { failed, detail: { reason } } : {}),
          };
        },
        async outcome => {
          const after = new Map<
            string,
            Awaited<ReturnType<typeof budgetedMonth>>
          >();
          for (const m of months.keys()) after.set(m, await budgetedMonth(m));
          const done = new Set(outcome.applied ?? []);
          return {
            cells: plan.map(c =>
              withText(
                {
                  month: c.month,
                  category_id: c.category_id,
                  ...moneyAs('before', c.before),
                  ...moneyAs(
                    'after',
                    after.get(c.month)!.get(c.category_id)?.amount ?? c.amount,
                  ),
                },
                { category: after.get(c.month)!.get(c.category_id)?.name },
              ),
            ),
            applied: outcome.applied ?? [],
            ...(outcome.failed
              ? {
                  failed: outcome.failed,
                  not_written: plan
                    .map(c => c.key)
                    .filter(k => !done.has(k) && k !== outcome.failed),
                  failure:
                    outcome.detail?.reason === 'changed'
                      ? 'That cell changed since it was read, so it and the cells after it were not written. Cells listed as applied were written; write_undo restores them.'
                      : 'The engine failed on that cell, so it and the cells after it were not written. Cells listed as applied were written; write_undo restores them.',
                }
              : {}),
          };
        },
      );
    },
    { scopes: ['budget:write'] },
  );
}
