import * as api from '@actual-app/api';
import { z } from 'zod';

import type { AuditChange } from '#audit';
import type { Limits } from '#limits';
import { Refusal } from '#refusal';
import { withText } from '#sanitize';
import { date, money } from '#tools/read/shared';

import {
  confirm,
  id,
  loggedWrite,
  notes,
  requireAmount,
  requireDate,
  requireDeleteRows,
  requireIds,
  requireRows,
  requireUndoableLine,
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

export function registerTransactionWriteTools(
  tool: RegisterWriteTool,
  limits: Limits,
) {
  tool(
    'write_create_transactions',
    `Create up to ${limits.maxRows} transactions in one account. account_id, payee_id and category_id must be ids from the read tools, never names. Amounts are integer cents (negative for spending). Returns the created rows.`,
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
        .max(limits.rowsCeiling),
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
    `Change up to ${limits.maxRows} transactions by id: category, payee, notes, amount (integer cents), date, account and cleared. category_id, payee_id and account_id must be ids from the read tools, never names; null clears category, payee or notes. The named rows change together or not at all. Rules, as in the app: date, account and cleared are set on a split parent and its children follow; after the call every split it touches must add up (a split's parent and child amounts can change in one call); a transfer's other side follows (opposite amount, notes, schedule, transfer payee, category cleared) in a second step, keeping its own date; a transfer side cannot move into its other side's account, and a payee change that would link or unlink a transfer is refused; moving to an off-budget account clears the category; a closed account cannot be a target. Changing amount, date, account or payee of a reconciled row (or of a transfer whose other side is reconciled), or setting cleared false on a reconciled row, needs allow_reconciled true on that row, which the connection's grant must allow; a new account or cleared false then un-reconciles it. Returns each changed field's before and after values, read back, including the cascaded rows.`,
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
        .max(limits.rowsCeiling),
    },
    async ({ updates }, auditLog) => {
      requireRows(auditLog, updates.length);
      const ids = updates.map(u => u.id);
      if (new Set(ids).size !== ids.length) {
        throw new Refusal('Each transaction id may appear only once.');
      }
      if (
        updates.some(u => u.allow_reconciled) &&
        !auditLog.grant.allow_reconciled
      ) {
        throw new Refusal(
          "This connection's grant does not allow overriding reconciled transactions. Change them in the app. Nothing changed.",
        );
      }
      const plan = await planUpdates(updates);
      // The cap also counts the rows that follow: split children and partners
      requireRows(auditLog, new Set(plan.changes.map(c => c.id)).size);

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
            // Unknown, not "nothing applied": a transfer-step failure has
            // already written the named rows
            unverified = true;
            return { applied: null, failed, read_back: 'failed' };
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
        async outcome => {
          const overridden =
            plan.reconciledOverridden.length > 0
              ? { reconciled_overridden: plan.reconciledOverridden }
              : {};
          if (unverified) {
            return {
              applied: null,
              failed,
              read_back: 'failed',
              ...overridden,
              failure:
                'The engine failed and the rows could not be read back. Check the budget before retrying.',
            };
          }
          return updateResult(
            outcome.applied ?? [],
            plan.changes,
            failed === undefined
              ? overridden
              : {
                  ...overridden,
                  failed,
                  partners_not_updated: partnersNotUpdated ?? [],
                  failure:
                    'The engine failed. Rows in `applied` hold their new values; transfer partners in `partners_not_updated` were not updated. `items` show the values read back.',
                },
          );
        },
      );
    },
    { scopes: ['transactions:write'] },
  );

  tool(
    'write_delete_transactions',
    `Delete transactions by id, as the app does, at most ${limits.maxDeleteRows} rows by default counting every row it removes. Deleting a split parent deletes its children; deleting a transfer deletes its other side (when that side is a split child it is unlinked, not deleted); attachments go with their rows. A split child cannot be deleted on its own. A reconciled row, or a row whose transfer partner, child's partner or unlinked partner child is reconciled, needs allow_reconciled true, which the connection's grant must allow. When this connection must confirm deletes, the first call changes nothing and returns a dry run listing every row, with \`confirm\`; call again with it within 5 minutes. Undoable with write_undo.`,
    {
      ids: z.array(id).min(1).max(limits.rowsCeiling),
      allow_reconciled: z.boolean().optional(),
      confirm,
    },
    async ({ ids, allow_reconciled }, auditLog) => {
      if (new Set(ids).size !== ids.length) {
        throw new Refusal('Each transaction id may appear only once.');
      }
      if (allow_reconciled && !auditLog.grant.allow_reconciled) {
        throw new Refusal(
          "This connection's grant does not allow overriding reconciled transactions. Change them in the app. Nothing changed.",
        );
      }
      const named = await editRows({ id: { $oneof: ids } });
      const known = new Set(named.map(t => t.id));
      const unknown = ids.filter(x => !known.has(x));
      if (unknown.length > 0) {
        throw new Refusal(
          `Every id must be an existing transaction (unknown or already deleted: ${unknown.join(', ')}). Nothing changed.`,
        );
      }
      const child = named.find(t => t.is_child);
      if (child) {
        throw new Refusal(
          `Row ${child.id} is a split child of ${child.parent_id}. Delete the split parent, or edit the child with write_update_transactions. Nothing changed.`,
        );
      }

      // Everything the app deletes: the named rows, a parent's children, and
      // each transfer partner (a partner that is a split child is unlinked)
      const parentIds = named.filter(t => t.is_parent).map(t => t.id);
      const deleted = new Map(named.map(t => [t.id, t]));
      if (parentIds.length > 0) {
        for (const c of await editRows({ parent_id: { $oneof: parentIds } })) {
          deleted.set(c.id, c);
        }
      }
      const partnerIds = [
        ...new Set(
          [...deleted.values()].flatMap(t =>
            !t.is_parent && t.transfer_id && !deleted.has(t.transfer_id)
              ? [t.transfer_id]
              : [],
          ),
        ),
      ];
      const unlinked = new Map<string, EditRow>();
      if (partnerIds.length > 0) {
        for (const p of await editRows({ id: { $oneof: partnerIds } })) {
          (p.is_child ? unlinked : deleted).set(p.id, p);
        }
      }

      const locked = [...deleted.values(), ...unlinked.values()].filter(
        t => t.reconciled,
      );
      if (locked.length > 0 && !allow_reconciled) {
        throw new Refusal(
          `Reconciled: ${locked.map(t => t.id).join(', ')}. Set allow_reconciled to delete reconciled rows (and rows linked to them). Nothing changed.`,
        );
      }
      requireDeleteRows(auditLog, deleted.size);

      const { data: attachments } = (await api.runQuery(
        api
          .q('transaction_attachments')
          .filter({ transaction_id: { $oneof: [...deleted.keys()] } })
          .select(['id', 'transaction_id']),
      )) as { data: Array<{ id: string; transaction_id: string }> };

      // Ids and values only: everything an undo needs to put the rows back
      const changes: AuditChange[] = [
        ...[...deleted.values()].map(t => ({
          id: t.id,
          field: 'transaction',
          before: {
            account: t.account,
            date: t.date,
            payee: t.payee,
            transfer_id: t.transfer_id,
            parent_id: t.parent_id,
            reconciled: t.reconciled,
          },
          after: null,
        })),
        ...[...unlinked.values()].map(t => ({
          id: t.id,
          field: 'unlink',
          before: {
            account: t.account,
            date: t.date,
            transfer_id: t.transfer_id,
            payee: t.payee,
            reconciled: t.reconciled,
          },
          after: { transfer_id: null, payee: null },
        })),
        ...attachments.map(a => ({
          id: a.id,
          field: 'attachment',
          before: { transaction_id: a.transaction_id },
          after: null,
        })),
        ...locked.map(t => ({
          id: t.id,
          field: 'allow_reconciled',
          before: null,
          after: true,
        })),
      ];
      const entry = {
        ids: [...deleted.keys(), ...unlinked.keys()],
        changes,
      };
      await requireUndoableLine(auditLog, 'write_delete_transactions', entry);

      // The partner children actually unlinked, read back after a failure
      const unlinkedDone = new Set<string>();
      return loggedWrite(
        auditLog,
        'write_delete_transactions',
        entry,
        async callId => {
          try {
            for (const rowId of ids) await api.deleteTransaction(rowId);
            for (const k of unlinked.keys()) unlinkedDone.add(k);
            return { applied: [...deleted.keys()] };
          } catch (error) {
            stderrLine(
              auditLog,
              `write_delete_transactions failed (call ${callId})`,
              error,
            );
          }
          // Report what the read-back shows, not a blanket "nothing deleted"
          const left = new Set(
            (await editRows({ id: { $oneof: [...deleted.keys()] } })).map(
              t => t.id,
            ),
          );
          if (unlinked.size > 0) {
            for (const t of await editRows({
              id: { $oneof: [...unlinked.keys()] },
            })) {
              if (t.transfer_id === null) unlinkedDone.add(t.id);
            }
          }
          return {
            applied: [...deleted.keys()].filter(x => !left.has(x)),
            failed: callId,
          };
        },
        async outcome => ({
          deleted: outcome.applied ?? [],
          unlinked: [...unlinkedDone],
          attachments: attachments.length,
          ...(outcome.failed
            ? {
                failed: outcome.failed,
                failure:
                  'The engine failed partway. Rows in `deleted` are gone; the rest are unchanged. Check the budget before retrying.',
              }
            : {}),
        }),
      );
    },
    { scopes: ['transactions:write', 'delete'], destructive: true },
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
