import * as api from '@actual-app/api';
import { isMovedHistory } from '@actual-app/core/shared/moved-history';
import { z } from 'zod';

import { buildPage, pageParams } from '#paging';
import { withText } from '#sanitize';

import { date, money, moneyAs, pageShape } from './shared';
import type { RegisterTool } from './shared';

type BudgetStatus = {
  business_calendar_id: string | null;
  deposit_days_early: number | null;
  budget_start_date: string | null;
  budget_start_offset: string | null;
};

async function getBudgetStatus(accountId: string): Promise<BudgetStatus> {
  const { data } = (await api.runQuery(
    api
      .q('accounts')
      .filter({ id: accountId })
      .select([
        'business_calendar_id',
        'deposit_days_early',
        'budget_start_date',
        'budget_start_offset',
      ]),
  )) as { data: BudgetStatus[] };
  if (!data[0]) throw new Error(`No account ${accountId}`);
  return data[0];
}

export function registerAccountTools(tool: RegisterTool) {
  tool(
    'get_account_budget_status',
    "Get an account's business calendar, days early for deposits, and the budget start date and offset line set when it was moved on budget (null when never moved).",
    { account_id: z.string() },
    async ({ account_id }) => ({
      account_id,
      ...(await getBudgetStatus(account_id)),
    }),
  );

  tool(
    'list_moved_history',
    "List a moved account's history: its transactions before the budget start date and its offset line. These are already in the starting balance and are not uncategorized. Empty for an account never moved. Amounts are cents.",
    { account_id: z.string(), ...pageShape },
    async ({ account_id, ...input }) => {
      const p = pageParams(input);
      const status = await getBudgetStatus(account_id);
      if (!status.budget_start_date) return buildPage([], p);
      const { data } = (await api.runQuery(
        api
          .q('transactions')
          .filter({
            account: account_id,
            $or: [
              { date: { $lt: status.budget_start_date } },
              ...(status.budget_start_offset
                ? [{ id: status.budget_start_offset }]
                : []),
            ],
          })
          .select([
            'id',
            'date',
            'amount',
            'cleared',
            'payee.name',
            'imported_payee',
            'notes',
          ])
          .orderBy([{ date: 'desc' }, 'id'])
          .limit(p.limit + 1)
          .offset(p.offset),
      )) as { data: Array<Record<string, unknown>> };
      // The shared classifier has the last word on what counts as moved history
      const moved = data.filter(t =>
        isMovedHistory({ id: String(t.id), date: String(t.date) }, status),
      );
      return buildPage(
        moved.map(t =>
          withText(
            {
              id: t.id,
              date: t.date,
              ...money(Number(t.amount)),
              cleared: t.cleared,
              account_id,
              is_offset_line: t.id === status.budget_start_offset,
            },
            {
              payee: t['payee.name'],
              imported_payee: t.imported_payee,
              notes: t.notes,
            },
          ),
        ),
        p,
      );
    },
  );

  tool(
    'preview_move_on_budget',
    'Preview moving an off-budget account on budget at a start date (YYYY-MM-DD): how many transactions become uncategorized, categories cleared or kept, transfers touched and the starting balance. Changes nothing.',
    { account_id: z.string(), start_date: date },
    async ({ account_id, start_date }) => {
      const x = await api.previewMoveAccountOnBudget(account_id, start_date);
      return {
        account_id,
        start_date,
        before: x.before,
        from_uncategorized: x.fromUncategorized,
        categories_cleared: x.categoriesCleared,
        categories_kept: x.categoriesKept,
        ...moneyAs('starting_balance', x.startingBalance),
        transfers: x.transfers.map(t =>
          withText(
            {
              id: t.id,
              date: t.date,
              ...money(t.amount),
              other_account_id: t.otherAccount,
              kept_category_id: t.keptCategory,
            },
            { other_account: t.otherAccountName },
          ),
        ),
      };
    },
  );
}
