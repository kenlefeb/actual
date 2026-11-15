import * as api from '@actual-app/api';
import { z } from 'zod';

import type { AuditChange } from '#audit';
import { Refusal } from '#refusal';
import { withText } from '#sanitize';
import { date, money } from '#tools/read/shared';

import {
  id,
  loggedWrite,
  MAX_WRITE_ROWS,
  notes,
  requireAmount,
  requireDate,
  requireIds,
  requireRows,
  stderrLine,
} from './shared';
import type { RegisterWriteTool } from './shared';
import {
  editRows,
  FIELD_COLUMN,
  planUpdates,
  refuseCategorizingMovedHistory,
} from './update-plan';
import type { EditRow, Update } from './update-plan';

const ROW_FIELDS = [
  'id',
  'account',
  'date',
  'amount',
  'category',
  'payee',
  'notes',
];

type Row = {
  id: string;
  account: string;
  date: string;
  amount: number;
  category: string | null;
  payee: string | null;
  notes: string | null;
};

async function rowsWhere(filter: Record<string, unknown>) {
  const { data } = (await api.runQuery(
    api.q('transactions').filter(filter).select(ROW_FIELDS),
  )) as { data: Row[] };
  return data;
}

async function names(table: 'categories' | 'payees', ids: unknown[]) {
  const wanted = ids.filter((x): x is string => typeof x === 'string');
  if (wanted.length === 0) return new Map<string, unknown>();
  const { data } = (await api.runQuery(
    api
      .q(table)
      .filter({ id: { $oneof: [...new Set(wanted)] } })
      .select(['id', 'name']),
  )) as { data: Array<{ id: string; name: string }> };
  return new Map<string, unknown>(data.map(r => [r.id, r.name]));
}

function rowOut(t: Row) {
  return withText(
    {
      id: t.id,
      date: t.date,
      ...money(t.amount),
      category_id: t.category,
      payee_id: t.payee,
    },
    { notes: t.notes },
  );
}

export function registerTransactionWriteTools(tool: RegisterWriteTool) {
  tool(
    'write_create_transactions',
    `Create up to ${MAX_WRITE_ROWS} transactions in one account. account_id, payee_id and category_id must be ids from the read tools, never names. Amounts are integer cents (negative for spending). Returns the created rows.`,
    {
      account_id: id,
      transactions: z
        .array(
          z
            .object({
              date,
              amount: z.number(), // bounds: requireAmount, with fixed text
              payee_id: id.optional(),
              category_id: id.optional(),
              notes: notes.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_WRITE_ROWS),
    },
    async ({ account_id, transactions }, auditLog) => {
      requireRows(auditLog, transactions.length);
      for (const t of transactions) {
        requireAmount(t.amount);
        requireDate(t.date);
      }
      await requireIds('accounts', [account_id]);
      await requireIds(
        'payees',
        transactions.flatMap(t => (t.payee_id ? [t.payee_id] : [])),
      );
      await requireIds(
        'categories',
        transactions.flatMap(t => (t.category_id ? [t.category_id] : [])),
      );
      await refuseCategorizingMovedHistory(
        transactions
          .filter(t => t.category_id)
          .map(t => ({ id: '', account: account_id, date: t.date })),
      );
      const existing = new Set(
        (await rowsWhere({ account: account_id })).map(t => t.id),
      );
      const rows = transactions.map(t => ({
        date: t.date,
        amount: t.amount,
        payee: t.payee_id,
        category: t.category_id,
        notes: t.notes,
      }));

      let created: Row[] = [];
      let readBack = true;
      return loggedWrite(
        auditLog,
        'write_create_transactions',
        {
          ids: [account_id],
          changes: rows.map((row, i) => ({
            id: `new:${i}`,
            field: 'transaction',
            before: null,
            after: row,
          })),
        },
        async () => {
          await api.addTransactions(account_id, rows);
          // shortcut: the API returns no ids, so a read-back diff finds them;
          // upgrade if addTransactions ever returns the created ids. A failed
          // read-back must not turn a write that happened into a "failed" one:
          // the outcome line is `ok` with no ids and the result says so.
          try {
            created = (await rowsWhere({ account: account_id })).filter(
              t => !existing.has(t.id),
            );
          } catch {
            readBack = false;
          }
          const ids = created.map(t => t.id);
          return { applied: ids, created: ids };
        },
        async () => ({
          account_id,
          items: created.map(rowOut),
          ...(readBack
            ? {}
            : {
                read_back:
                  'The rows were created but could not be read back. Check the account.',
              }),
        }),
      );
    },
    { scopes: ['transactions:write'] },
  );

  tool(
    'write_update_transactions',
    `Change up to ${MAX_WRITE_ROWS} transactions by id: category, payee, notes, amount (integer cents), date, account and cleared. category_id, payee_id and account_id must be ids from the read tools, never names; null clears category, payee or notes. The named rows change together or not at all. Rules, as in the app: date, account and cleared are set on a split parent and its children follow; after the call every split it touches must add up (a split's parent and child amounts can change in one call); a transfer's other side follows (opposite amount, notes, schedule, transfer payee, category cleared) in a second step, keeping its own date; a transfer side cannot move into its other side's account; moving to an off-budget account clears the category; a closed account cannot be a target. Changing amount, date, account or payee of a reconciled row (or of a transfer whose other side is reconciled), or setting cleared false on a reconciled row, needs allow_reconciled true on that row; a new account or cleared false then un-reconciles it. Returns each changed field's before and after values, read back, including the cascaded rows.`,
    {
      updates: z
        .array(
          z
            .object({
              id,
              category_id: id.nullable().optional(),
              payee_id: id.nullable().optional(),
              notes: notes.nullable().optional(),
              amount: z.number().optional(), // bounds: requireAmount, with fixed text
              date: date.optional(), // bounds: requireDate, with fixed text
              account_id: id.optional(),
              cleared: z.boolean().optional(),
              allow_reconciled: z.boolean().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_WRITE_ROWS),
    },
    async ({ updates }, auditLog) => {
      // The cap counts the rows the call names, not the rows that follow
      requireRows(auditLog, updates.length);
      const ids = updates.map(u => u.id);
      if (new Set(ids).size !== ids.length) {
        throw new Refusal('Each transaction id may appear only once.');
      }
      const plan = await planUpdates(updates);

      let failed: string | undefined;
      let partnersNotUpdated: string[] | undefined;
      let unverified = false;
      return loggedWrite(
        auditLog,
        'write_update_transactions',
        { ids, changes: plan.changes },
        async callId => {
          try {
            await api.updateTransactions(plan.sends);
            return { applied: ids };
          } catch (error) {
            stderrLine(
              auditLog,
              `write_update_transactions failed (call ${callId})`,
              error,
            );
            failed = callId;
          }
          // The named rows are one batch and transfer partners a second one:
          // report what the read-back shows, not a blanket "nothing applied".
          let now: Map<string, EditRow>;
          try {
            now = await readBack(plan.changes);
          } catch {
            unverified = true;
            return { applied: [], failed };
          }
          const holds = (c: AuditChange) => {
            const column = FIELD_COLUMN[c.field];
            const value = now.get(c.id)?.[column];
            const sent = plan.sends.find(s => s.id === c.id)?.fields;
            return value === c.after || (sent && value === sent[column]);
          };
          const own = (rowId: string) =>
            plan.changes.filter(
              c => c.id === rowId && FIELD_COLUMN[c.field] !== undefined,
            );
          const applied = ids.filter(rowId =>
            own(rowId)
              .filter(c =>
                updates.some(
                  u =>
                    u.id === rowId && u[c.field as keyof Update] !== undefined,
                ),
              )
              .every(holds),
          );
          partnersNotUpdated = plan.partners.filter(
            rowId => !own(rowId).every(holds),
          );
          return {
            applied,
            failed,
            partners_not_updated: partnersNotUpdated,
          };
        },
        outcome =>
          updateResult(
            outcome.applied,
            plan.changes,
            failed === undefined
              ? {}
              : {
                  failed,
                  partners_not_updated: partnersNotUpdated ?? [],
                  failure: unverified
                    ? 'The engine failed and the rows could not be read back. Check the budget before retrying.'
                    : 'The engine failed. Rows in `applied` hold their new values; transfer partners in `partners_not_updated` were not updated. `items` show the values read back.',
                },
          ),
      );
    },
    { scopes: ['transactions:write'] },
  );
}

/** Every row in `changes`, read back. */
async function readBack(changes: AuditChange[]) {
  const rowIds = [...new Set(changes.map(c => c.id))];
  return new Map(
    (await editRows({ id: { $oneof: rowIds } })).map(t => [t.id, t]),
  );
}

/** The update tool's result: each change's before and after, read back. */
async function updateResult(
  applied: string[],
  allChanges: AuditChange[],
  failure: Record<string, unknown>,
) {
  // allow_reconciled is in the audit line, not a column to read back
  const changes = allChanges.filter(c => FIELD_COLUMN[c.field] !== undefined);
  const now = await readBack(changes);
  const valueNow = (c: AuditChange) =>
    now.get(c.id)?.[FIELD_COLUMN[c.field]] ?? null;
  const values = [...changes.map(c => c.before), ...changes.map(valueNow)];
  const categoryNames = await names('categories', values);
  const payeeNames = await names('payees', values);
  const label = (field: string, value: unknown) =>
    field === 'category_id'
      ? (categoryNames.get(value as string) ?? null)
      : field === 'payee_id'
        ? (payeeNames.get(value as string) ?? null)
        : value;

  return {
    applied,
    ...failure,
    items: [...new Set(changes.map(c => c.id))].map(txId => ({
      id: txId,
      changes: changes
        .filter(c => c.id === txId)
        .map(c => {
          const after = valueNow(c);
          // Notes are free text: only under `text`.
          return c.field === 'notes'
            ? withText({ field: c.field }, { before: c.before, after })
            : c.field === 'category_id' || c.field === 'payee_id'
              ? withText(
                  { field: c.field, before: c.before, after },
                  {
                    before: label(c.field, c.before),
                    after: label(c.field, after),
                  },
                )
              : { field: c.field, before: c.before, after };
        }),
    })),
  };
}
