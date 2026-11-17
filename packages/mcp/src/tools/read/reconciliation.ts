import * as api from '@actual-app/api';
import { z } from 'zod';

import { moneyAs } from './shared';
import type { RegisterTool } from './shared';

export type ReconRow = {
  id: string;
  account: string;
  date: string;
  amount: number;
  cleared: boolean;
  reconciled: boolean;
  transfer_id: string | null;
  parent_id: string | null;
  is_child: boolean;
};

export const RECON_FIELDS = [
  'id',
  'account',
  'date',
  'amount',
  'cleared',
  'reconciled',
  'transfer_id',
  'parent_id',
  'is_child',
];

/** Every row of the account, split children included. */
export async function accountRows(accountId: string) {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter({ account: accountId })
      .options({ splits: 'all' })
      .select(RECON_FIELDS),
  )) as { data: ReconRow[] };
  return data;
}

/**
 * What a reconcile sees, as the app does: the cleared balance sums cleared rows
 * that are not split children (a split counts once, through its parent); the
 * rows to lock are those cleared, unreconciled non-children plus every child of
 * one; a child whose parent is already reconciled while it is not is skipped.
 */
export function reconciliation(rows: ReconRow[]) {
  const parents = new Map(rows.filter(r => !r.is_child).map(r => [r.id, r]));
  const clearedBalance = rows
    .filter(r => r.cleared && !r.is_child)
    .reduce((sum, r) => sum + r.amount, 0);
  const selected = rows.filter(r => !r.is_child && r.cleared && !r.reconciled);
  const selectedIds = new Set(selected.map(r => r.id));
  const children = rows.filter(
    r => r.is_child && r.parent_id && selectedIds.has(r.parent_id),
  );
  const skippedChildren = rows
    .filter(
      r =>
        r.is_child &&
        !r.reconciled &&
        r.parent_id &&
        parents.get(r.parent_id)?.reconciled,
    )
    .map(r => r.id);
  return { clearedBalance, selected, children, skippedChildren };
}

export async function lastReconciledOf(accountId: string) {
  const { data } = (await api.runQuery(
    api.q('accounts').filter({ id: accountId }).select(['last_reconciled']),
  )) as { data: Array<{ last_reconciled: string | null }> };
  return data[0]?.last_reconciled ?? null;
}

export function registerReconciliationTools(tool: RegisterTool) {
  tool(
    'get_account_reconciliation',
    "Get an account's cleared balance (cleared rows, split children left out), the count of cleared, unreconciled rows a reconcile would lock (children excluded) and `last_reconciled` (a millisecond timestamp, or null). These are the same numbers write_reconcile_account uses. The cleared balance is the app's own figure, not proof of a statement balance: compare it with the bank's statement, not with itself. Amounts are cents.",
    { account_id: z.string() },
    async ({ account_id }) => {
      if (!(await api.getAccounts()).some(a => a.id === account_id)) {
        throw new Error(`No account ${account_id}`);
      }
      const r = reconciliation(await accountRows(account_id));
      return {
        account_id,
        ...moneyAs('cleared_balance', r.clearedBalance),
        cleared_unreconciled_rows: r.selected.length,
        last_reconciled: await lastReconciledOf(account_id),
      };
    },
  );
}
