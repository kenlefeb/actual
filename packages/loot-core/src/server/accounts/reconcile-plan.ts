// Fork-only (sc-4825, native-reconcile-resolve-and-lock D1). What a reconcile
// locks, decided once: the account's cleared, unreconciled rows that are not
// split children, every child of a selected parent, the transfer partners of
// those rows (listed, never written) and the unreconciled children of an
// already reconciled parent (skipped). The parity test pins this to the MCP's
// reconciliation() and the web's lockTransactions.
import { aqlQuery } from '#server/aql';
import { q } from '#shared/query';

type PlanRow = {
  id: string;
  date: string;
  amount: number;
  cleared: boolean;
  reconciled: boolean;
  transfer_id: string | null;
  parent_id: string | null;
  is_child: boolean;
};

export type LockPlan = {
  // Parents and plain rows, then the children that follow them
  rows: PlanRow[];
  children: PlanRow[];
  // Every id the lock writes
  ids: string[];
  skippedChildren: string[];
  partners: {
    id: string;
    account: string;
    amount: number;
    date: string;
    reconciled: boolean;
  }[];
};

export async function lockPlan(accountId: string): Promise<LockPlan> {
  const { data: all } = (await aqlQuery(
    q('transactions')
      .filter({ account: accountId })
      .options({ splits: 'all' })
      .select([
        'id',
        'date',
        'amount',
        'cleared',
        'reconciled',
        'transfer_id',
        'parent_id',
        'is_child',
      ])
      .orderBy([{ date: 'desc' }, { sort_order: 'desc' }, 'id']),
  )) as { data: PlanRow[] };

  const parents = new Map(all.filter(r => !r.is_child).map(r => [r.id, r]));
  const rows = all.filter(r => !r.is_child && r.cleared && !r.reconciled);
  const selected = new Set(rows.map(r => r.id));
  const children = all.filter(
    r => r.is_child && r.parent_id && selected.has(r.parent_id),
  );
  const skippedChildren = all
    .filter(
      r =>
        r.is_child &&
        !r.reconciled &&
        r.parent_id &&
        parents.get(r.parent_id)?.reconciled,
    )
    .map(r => r.id);

  const partnerIds = [...rows, ...children]
    .map(r => r.transfer_id)
    .filter((id): id is string => !!id);
  const { data: partners } =
    partnerIds.length > 0
      ? ((await aqlQuery(
          q('transactions')
            .filter({ id: { $oneof: partnerIds } })
            .options({ splits: 'all' })
            .select([
              'id',
              { account: 'account.name' },
              'amount',
              'date',
              'reconciled',
            ])
            .orderBy(['id']),
        )) as { data: LockPlan['partners'] })
      : { data: [] };

  return {
    rows,
    children,
    ids: [...rows, ...children].map(r => r.id),
    skippedChildren,
    partners: partners.map(p => ({ ...p, reconciled: Boolean(p.reconciled) })),
  };
}
