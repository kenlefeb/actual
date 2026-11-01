import * as api from '@actual-app/api';
import { z } from 'zod';

import { Refusal } from '#tools/read/shared';

/** At most this many rows change in one write call. */
export const MAX_WRITE_ROWS = 50;

export const id = z.string().min(1).max(100);
export const notes = z.string().max(1000);

/**
 * Returns `ids` mapped to their rows' `select` fields, refusing (fixed text)
 * when any id is not an existing row: a name is never matched in its place.
 */
export async function requireIds(
  table: 'transactions' | 'accounts' | 'categories' | 'payees',
  ids: string[],
  select: string[] = ['id'],
): Promise<Map<string, Record<string, unknown>>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = (await api.runQuery(
    api
      .q(table)
      .filter({ id: { $oneof: unique } })
      .select(['id', ...select]),
  )) as { data: Array<Record<string, unknown>> };
  if (data.length !== unique.length) {
    throw new Refusal(
      `Every ${table} id must be the id of an existing row, never a name.`,
    );
  }
  return new Map(data.map(row => [String(row.id), row]));
}
