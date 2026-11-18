import * as api from '@actual-app/api';
import type {
  UndeleteRowState,
  UndeleteTable,
} from '@actual-app/core/types/api-handlers';

import type { AuditChange } from '#audit';

import { budgetedMonth } from './budget';
import { budgetId, requireCells } from './shared';
import type { WriteLog } from './shared';

export type { UndeleteRowState };

export const rowKey = (table: string, id: string) => `${table}:${id}`;

/** Reads the named rows' state through the fork handler's `check` mode; changes nothing. */
export async function checkRows(
  rows: Array<{ table: UndeleteTable; id: string }>,
) {
  const states = new Map<string, UndeleteRowState>();
  if (rows.length === 0) return states;
  const res = await api.undeleteRows({
    budget_id: await budgetId(),
    rows,
    check: true,
  });
  if (!res.check) throw new Error('undeleteRows did not return a check');
  for (const s of res.rows) states.set(rowKey(s.table, s.id), s);
  return states;
}

export type DeletedCategory = { id: string; group_id: string };

/**
 * What a category or group delete changes beyond the tombstones, so its undo
 * can put it back (ids and values only): each category's group, the mapping
 * rows a delete with a transfer re-points (the category's own and every
 * deleted category that forwarded to it) and the transfer category's budget
 * cells, as `budgeted:YYYY-MM` before and after. Refuses, with the cell
 * limit's text, when the cells exceed the limit.
 */
export async function deleteSnapshot(
  log: WriteLog,
  categories: DeletedCategory[],
  transferId: string | undefined,
  /** An expense delete adds the amounts to the transfer category; an income one does not. */
  moveCells: boolean,
): Promise<AuditChange[]> {
  const changes: AuditChange[] = categories.map(c => ({
    id: c.id,
    field: 'group_id',
    before: c.group_id,
    after: null,
  }));
  if (!transferId) return changes;

  const states = await checkRows(
    categories.map(c => ({ table: 'categories' as const, id: c.id })),
  );
  for (const c of categories) {
    const s = states.get(rowKey('categories', c.id));
    changes.push({
      id: c.id,
      field: 'mapping',
      before: s?.columns.mapping ?? c.id,
      after: transferId,
    });
    for (const from of (s?.columns.mapped_from as string[] | undefined) ?? []) {
      changes.push({
        id: from,
        field: 'mapping',
        before: c.id,
        after: transferId,
      });
    }
  }

  if (!moveCells) return changes;
  // doTransfer adds the deleted categories' amounts to the transfer, month by month
  const months = new Set<string>();
  for (const c of categories) {
    for (const m of (await api.getCategoryUsage(c.id)).months) months.add(m);
  }
  requireCells(log, months.size);
  for (const month of [...months].sort()) {
    const cells = await budgetedMonth(month);
    const added = categories.reduce(
      (sum, c) => sum + (cells.get(c.id)?.amount ?? 0),
      0,
    );
    const before = cells.get(transferId)?.amount ?? 0;
    if (added !== 0) {
      changes.push({
        id: transferId,
        field: `budgeted:${month}`,
        before,
        after: before + added,
      });
    }
  }
  return changes;
}
