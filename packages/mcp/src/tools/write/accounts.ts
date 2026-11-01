import * as api from '@actual-app/api';
import { z } from 'zod';

import { Refusal } from '#refusal';
import { getBudgetStatus, moveConfirm } from '#tools/read/accounts';
import { date } from '#tools/read/shared';
import type { RegisterTool } from '#tools/read/shared';

import { id, loggedWrite, requireDate } from './shared';

export function registerAccountWriteTools(
  tool: RegisterTool,
  auditLog: string,
) {
  tool(
    'write_move_on_budget',
    'Move an off-budget account on budget at a start date (YYYY-MM-DD), by account id (never a name). Call preview_move_on_budget first and pass its `confirm`: the move is refused when a fresh preview for the same account and date differs. Returns the account status before and after.',
    { account_id: id, start_date: date, confirm: z.string().max(128) },
    async ({ account_id, start_date, confirm }) => {
      requireDate(start_date);
      const account = (await api.getAccounts()).find(a => a.id === account_id);
      if (!account) {
        throw new Refusal(
          'account_id must be the id of an existing account, never a name.',
        );
      }
      if (!account.offbudget) {
        throw new Refusal('The account is already on budget.');
      }
      const preview = await api.previewMoveAccountOnBudget(
        account_id,
        start_date,
      );
      if (moveConfirm(account_id, start_date, preview) !== confirm) {
        throw new Refusal(
          'confirm does not match a fresh preview_move_on_budget for this account and start date. Preview again.',
        );
      }
      const before = await getBudgetStatus(account_id);

      return loggedWrite(
        auditLog,
        'write_move_on_budget',
        {
          ids: [account_id],
          changes: [
            { id: account_id, field: 'offbudget', before: true, after: false },
            {
              id: account_id,
              field: 'budget_start_date',
              before: before.budget_start_date,
              after: start_date,
            },
          ],
        },
        async () => {
          await api.moveAccountOnBudget(account_id, start_date);
          return { applied: [account_id] };
        },
        async () => {
          const after = await getBudgetStatus(account_id);
          const offBudget = (await api.getAccounts()).find(
            a => a.id === account_id,
          )?.offbudget;
          return {
            account_id,
            off_budget: { before: true, after: offBudget },
            budget_start_date: {
              before: before.budget_start_date,
              after: after.budget_start_date,
            },
            budget_start_offset: after.budget_start_offset,
          };
        },
      );
    },
  );
}
