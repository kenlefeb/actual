import * as api from '@actual-app/api';
import { isMovedHistory } from '@actual-app/core/shared/moved-history';
import { z } from 'zod';

import { appendAudit } from '#audit';
import type { AuditChange } from '#audit';
import { Refusal } from '#refusal';
import { withText } from '#sanitize';
import { getBudgetStatus } from '#tools/read/accounts';
import { date, money } from '#tools/read/shared';
import type { RegisterTool } from '#tools/read/shared';

import { id, MAX_WRITE_ROWS, notes, requireIds } from './shared';

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

/**
 * Refuses (before any audit line or write) when a category would be set on
 * moved history: a moved account's transactions before its budget start date,
 * and its offset line, are already in the starting balance.
 */
async function refuseCategorizingMovedHistory(
  rows: Array<{ id: string; account: string; date: string }>,
) {
  const statuses = new Map<
    string,
    Awaited<ReturnType<typeof getBudgetStatus>>
  >();
  for (const row of rows) {
    if (!statuses.has(row.account)) {
      statuses.set(row.account, await getBudgetStatus(row.account));
    }
    if (isMovedHistory(row, statuses.get(row.account))) {
      throw new Refusal(
        "A category cannot be set on moved history (transactions before an account's budget start date, or its offset line). Do it in the app. Nothing changed.",
      );
    }
  }
}

// Field in the tool's input -> column in the transactions table
const FIELDS = {
  category_id: 'category',
  payee_id: 'payee',
  notes: 'notes',
} as const;
type Field = keyof typeof FIELDS;

export function registerTransactionWriteTools(
  tool: RegisterTool,
  auditLog: string,
) {
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
              amount: z.number().int(),
              payee_id: id.optional(),
              category_id: id.optional(),
              notes: notes.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_WRITE_ROWS),
    },
    async ({ account_id, transactions }) => {
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

      // Log first: a failed append stops the write.
      appendAudit(auditLog, {
        tool: 'write_create_transactions',
        ids: [account_id],
        changes: rows.map((row, i) => ({
          id: `new:${i}`,
          field: 'transaction',
          before: null,
          after: row,
        })),
      });
      await api.addTransactions(account_id, rows);

      const created = (await rowsWhere({ account: account_id })).filter(
        t => !existing.has(t.id),
      );
      return { account_id, items: created.map(rowOut) };
    },
  );

  tool(
    'write_update_transactions',
    `Set the category, payee or notes of up to ${MAX_WRITE_ROWS} transactions, by transaction id. category_id and payee_id must be ids from the read tools, never names; null clears. Returns each changed field's before and after values.`,
    {
      updates: z
        .array(
          z
            .object({
              id,
              category_id: id.nullable().optional(),
              payee_id: id.nullable().optional(),
              notes: notes.nullable().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_WRITE_ROWS),
    },
    async ({ updates }) => {
      const ids = updates.map(u => u.id);
      if (new Set(ids).size !== ids.length) {
        throw new Refusal('Each transaction id may appear only once.');
      }
      const before = await requireIds('transactions', ids, ROW_FIELDS);
      const pick = (f: Field) =>
        updates.flatMap(u => (typeof u[f] === 'string' ? [u[f]] : []));
      await requireIds('categories', pick('category_id'));
      await requireIds('payees', pick('payee_id'));
      await refuseCategorizingMovedHistory(
        updates
          .filter(u => u.category_id)
          .map(u => before.get(u.id) as unknown as Row),
      );

      const changes: AuditChange[] = updates.flatMap(u =>
        (Object.keys(FIELDS) as Field[])
          .filter(f => u[f] !== undefined)
          .map(f => ({
            id: u.id,
            field: f,
            before: before.get(u.id)![FIELDS[f]] ?? null,
            after: u[f] ?? null,
          })),
      );
      if (changes.length === 0) {
        throw new Refusal('No field to change.');
      }

      // Log first: a failed append stops the write.
      appendAudit(auditLog, {
        tool: 'write_update_transactions',
        ids,
        changes,
      });
      for (const u of updates) {
        const fields = Object.fromEntries(
          (Object.keys(FIELDS) as Field[])
            .filter(f => u[f] !== undefined)
            .map(f => [FIELDS[f], u[f] ?? null]),
        );
        await api.updateTransaction(u.id, fields);
      }

      const after = new Map(
        (await rowsWhere({ id: { $oneof: ids } })).map(t => [t.id, t]),
      );
      const values = [
        ...changes.map(c => c.before),
        ...changes.map(c => after.get(c.id)?.[FIELDS[c.field as Field]]),
      ];
      const categoryNames = await names('categories', values);
      const payeeNames = await names('payees', values);
      const label = (field: string, value: unknown) =>
        field === 'category_id'
          ? (categoryNames.get(value as string) ?? null)
          : field === 'payee_id'
            ? (payeeNames.get(value as string) ?? null)
            : value;

      return {
        items: ids.map(txId => ({
          id: txId,
          changes: changes
            .filter(c => c.id === txId)
            .map(c => {
              const now = after.get(txId)?.[FIELDS[c.field as Field]] ?? null;
              const text = {
                before: label(c.field, c.before),
                after: label(c.field, now),
              };
              // Notes are free text: only under `text`.
              return c.field === 'notes'
                ? withText({ field: c.field }, text)
                : withText(
                    { field: c.field, before: c.before, after: now },
                    text,
                  );
            }),
        })),
      };
    },
  );
}
