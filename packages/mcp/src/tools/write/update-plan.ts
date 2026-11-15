import * as api from '@actual-app/api';
import { isMovedHistory } from '@actual-app/core/shared/moved-history';
import type { TransactionEntity } from '@actual-app/core/types/models';

import type { AuditChange } from '#audit';
import { Refusal } from '#refusal';
import { getBudgetStatus } from '#tools/read/accounts';

import { requireAmount, requireDate, requireIds } from './shared';

/** One row of `write_update_transactions`. */
export type Update = {
  id: string;
  category_id?: string | null;
  payee_id?: string | null;
  notes?: string | null;
  amount?: number;
  date?: string;
  account_id?: string;
  cleared?: boolean;
  allow_reconciled?: boolean;
};

// Field in the tool's input -> column in the transactions table
export const FIELDS = {
  category_id: 'category',
  payee_id: 'payee',
  notes: 'notes',
  amount: 'amount',
  date: 'date',
  account_id: 'account',
  cleared: 'cleared',
} as const;
type Field = keyof typeof FIELDS;

// Column -> the field name the audit line and result use, for every column a
// call may change, cascades included
export const COLUMN_FIELD = {
  category: 'category_id',
  payee: 'payee_id',
  notes: 'notes',
  amount: 'amount',
  date: 'date',
  account: 'account_id',
  cleared: 'cleared',
  schedule: 'schedule',
  reconciled: 'reconciled',
} as const;
type Column = keyof typeof COLUMN_FIELD;
export const FIELD_COLUMN = Object.fromEntries(
  Object.entries(COLUMN_FIELD).map(([column, field]) => [field, column]),
) as Record<string, Column>;

export type EditRow = {
  id: string;
  account: string;
  date: string;
  amount: number;
  category: string | null;
  payee: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  schedule: string | null;
  transfer_id: string | null;
  is_parent: boolean;
  is_child: boolean;
  parent_id: string | null;
};

export const EDIT_FIELDS = [
  'account',
  'date',
  'amount',
  'category',
  'payee',
  'notes',
  'cleared',
  'reconciled',
  'schedule',
  'transfer_id',
  'is_parent',
  'is_child',
  'parent_id',
];

/** Transactions matching `filter`, split parents and children included. */
export async function editRows(filter: Record<string, unknown>) {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter(filter)
      .options({ splits: 'all' })
      .select(['id', ...EDIT_FIELDS]),
  )) as { data: EditRow[] };
  return data;
}

/**
 * Refuses (before any audit line or write) when a categorized row would be
 * on moved history: a moved account's transactions before its budget start
 * date, and its offset line, are already in the starting balance.
 */
export async function refuseCategorizingMovedHistory(
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
        "A categorized transaction cannot be on moved history (transactions before an account's budget start date, or its offset line). Do it in the app. Nothing changed.",
      );
    }
  }
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

/**
 * Checks a `write_update_transactions` call and predicts every change it
 * makes, as loot-core will: split children follow their parent (makeChild),
 * an off-budget account clears the category (batch update), and a transfer's
 * other side follows the edited side (transfer.updateTransfer and
 * clearCategory). Refuses with fixed text before anything is logged.
 */
export async function planUpdates(updates: Update[]) {
  for (const u of updates) {
    if (u.amount !== undefined) requireAmount(u.amount);
    if (u.date !== undefined) requireDate(u.date);
  }
  const ids = updates.map(u => u.id);
  const named = (await requireIds(
    'transactions',
    ids,
    EDIT_FIELDS,
  )) as unknown as Map<string, EditRow>;
  const pick = (f: 'category_id' | 'payee_id' | 'account_id') =>
    updates.flatMap(u => (typeof u[f] === 'string' ? [u[f]] : []));
  await requireIds('categories', pick('category_id'));
  await requireIds('payees', pick('payee_id'));
  const targets = await requireIds('accounts', pick('account_id'), ['closed']);

  // Every split the call touches, whole
  const parentIds = unique(
    [...named.values()].flatMap(t =>
      t.is_parent ? [t.id] : t.is_child && t.parent_id ? [t.parent_id] : [],
    ),
  );
  const before = new Map(named);
  if (parentIds.length > 0) {
    for (const t of await editRows({
      $or: [
        { id: { $oneof: parentIds } },
        { parent_id: { $oneof: parentIds } },
      ],
    })) {
      before.set(t.id, t);
    }
  }

  // The other side of each transfer in those rows
  const partnerIds = unique(
    [...before.values()].flatMap(t =>
      !t.is_parent && t.transfer_id ? [t.transfer_id] : [],
    ),
  );
  const partners = new Map(
    (partnerIds.length > 0
      ? await editRows({ id: { $oneof: partnerIds } })
      : []
    ).map(t => [t.id, t]),
  );
  const partnerOf = (t: EditRow) =>
    !t.is_parent && t.transfer_id ? partners.get(t.transfer_id) : undefined;

  for (const u of updates) {
    const t = named.get(u.id)!;
    if (
      t.is_child &&
      (u.date !== undefined ||
        u.account_id !== undefined ||
        u.cleared !== undefined)
    ) {
      throw new Refusal(
        `Row ${u.id} is part of a split. Set it on the split parent; its children follow. Nothing changed.`,
      );
    }
    if (u.account_id !== undefined && targets.get(u.account_id)?.closed) {
      throw new Refusal(
        `Row ${u.id} cannot move to a closed account. Reopen the account first. Nothing changed.`,
      );
    }
    const partner = partnerOf(t);
    if (partner && named.has(partner.id)) {
      throw new Refusal(
        `Rows ${u.id} and ${partner.id} are the two sides of one transfer. Change one side; the other follows. Nothing changed.`,
      );
    }
    if (partner && u.account_id === partner.account) {
      throw new Refusal(
        `Row ${u.id} is one side of a transfer and cannot move into its own other account. Nothing changed.`,
      );
    }
  }

  // The rows as they will be after the call
  const after = new Map([...before].map(([k, t]) => [k, { ...t }]));
  const sends = updates.map(u => {
    const t = named.get(u.id)!;
    const fields: Partial<Record<Column, unknown>> = {};
    for (const f of Object.keys(FIELDS) as Field[]) {
      if (u[f] !== undefined) fields[FIELDS[f]] = u[f];
    }
    // As onUpdateAfterConfirm: a new account or unclearing un-reconciles
    if (
      (u.account_id !== undefined && u.account_id !== t.account) ||
      (u.cleared === false && t.reconciled)
    ) {
      fields.reconciled = false;
    }
    Object.assign(after.get(u.id)!, fields);
    // The engine's type has no null for category or notes, but null clears them
    return { id: u.id, fields: fields as Partial<TransactionEntity> };
  });

  // Children follow their parent (makeChild), keeping a payee of their own
  for (const pid of parentIds) {
    const p0 = before.get(pid)!;
    const p = after.get(pid)!;
    for (const c of after.values()) {
      if (c.parent_id !== pid) continue;
      Object.assign(c, {
        account: p.account,
        date: p.date,
        cleared: p.cleared,
        reconciled: p.reconciled,
      });
      if (
        p.payee !== p0.payee &&
        before.get(c.id)!.payee === p0.payee &&
        !updates.some(u => u.id === c.id && u.payee_id !== undefined)
      ) {
        c.payee = p.payee;
      }
    }
  }

  const { data: accounts } = (await api.runQuery(
    api.q('accounts').select(['id', 'offbudget']),
  )) as { data: Array<{ id: string; offbudget: boolean }> };
  const offbudget = new Map(accounts.map(a => [a.id, Boolean(a.offbudget)]));

  // An off-budget account (and a split parent) holds no category
  for (const t of after.values()) {
    if (t.account !== before.get(t.id)!.account && offbudget.get(t.account)) {
      t.category = null;
    }
  }

  const { data: transferPayees } = (await api.runQuery(
    api
      .q('payees')
      .filter({ transfer_acct: { $ne: null } })
      .select(['id', 'transfer_acct']),
  )) as { data: Array<{ id: string; transfer_acct: string }> };
  const payeeAccount = new Map(
    transferPayees.map(p => [p.id, p.transfer_acct]),
  );
  const accountPayee = new Map(
    transferPayees.map(p => [p.transfer_acct, p.id]),
  );

  // transfer.onUpdate would delete the other side (removeTransfer) or insert
  // one (addTransfer): a create or delete this tool must not make (sc-4205)
  for (const t of after.values()) {
    const t0 = before.get(t.id)!;
    if (
      !t.is_parent &&
      t.payee !== t0.payee &&
      (t0.transfer_id || (t.payee && payeeAccount.has(t.payee)))
    ) {
      throw new Refusal(
        `Changing row ${t.id}'s payee would link or unlink a transfer; do it in the app (sc-4205). Nothing changed.`,
      );
    }
  }

  // A reconciled row, or a transfer whose other side is reconciled, changes
  // only with the override: the app's confirm-transaction-edit fields, plus
  // unclearing (stricter than the app). Split children carry their parent's
  // edit, so a child's partner is checked too.
  const overridden: string[] = [];
  for (const t of after.values()) {
    const t0 = before.get(t.id)!;
    const own = updates.find(u => u.id === t.id);
    const owner = own ?? updates.find(u => u.id === t.parent_id);
    const locked = (['amount', 'date', 'account', 'payee'] as const).some(
      c => t[c] !== t0[c],
    );
    const unclearing =
      t.cleared === false && (t0.cleared !== false || own?.cleared === false);
    const partner = partnerOf(t0);
    const rowLocked = t0.reconciled && (locked || unclearing);
    const partnerLocked = Boolean(partner?.reconciled) && locked;
    if (!rowLocked && !partnerLocked) continue;
    if (!owner?.allow_reconciled) {
      throw new Refusal(
        rowLocked
          ? `Row ${t.id} is reconciled; set allow_reconciled to change it. Nothing changed.`
          : `The other side of row ${t.id}'s transfer is reconciled; set allow_reconciled to change it. Nothing changed.`,
      );
    }
    if (rowLocked) overridden.push(t.id);
    if (partnerLocked && partner) overridden.push(partner.id);
  }

  // Transfer partners follow (transfer.updateTransfer, then clearCategory)
  const cascaded: string[] = [];
  for (const t of [...after.values()]) {
    const t0 = before.get(t.id)!;
    const partner = partnerOf(t0);
    const changed = (Object.keys(COLUMN_FIELD) as Column[]).some(
      c => t[c] !== t0[c],
    );
    const transferAccount = t.payee ? payeeAccount.get(t.payee) : undefined;
    if (!partner || !changed || transferAccount !== partner.account) continue;
    if (!before.has(partner.id)) {
      before.set(partner.id, partner);
      after.set(partner.id, { ...partner });
      cascaded.push(partner.id);
    }
    const p = after.get(partner.id)!;
    Object.assign(p, {
      amount: -t.amount,
      notes: t.notes,
      schedule: t.schedule,
    });
    // The engine always sets it; it differs only when the account changes
    if (t.account !== t0.account) {
      p.payee = accountPayee.get(t.account) ?? p.payee;
    }
    if (offbudget.get(t.account) === offbudget.get(partner.account)) {
      t.category = null;
      p.category = null;
    }
  }

  for (const pid of parentIds) {
    const total = [...after.values()]
      .filter(c => c.parent_id === pid)
      .reduce((sum, c) => sum + c.amount, 0);
    const off = after.get(pid)!.amount - total;
    if (off !== 0) {
      throw new Refusal(
        `Split ${pid} would be off by ${Math.abs(off)} cents: its children must add up to the parent amount. Nothing changed.`,
      );
    }
  }

  await refuseCategorizingMovedHistory(
    [...after.values()].filter(t => {
      const t0 = before.get(t.id)!;
      const categorized = updates.some(
        u => u.id === t.id && u.category_id !== undefined,
      );
      return (
        t.category !== null &&
        (categorized || t.date !== t0.date || t.account !== t0.account)
      );
    }),
  );

  // Named fields always; cascaded ones where the value changes
  const changes: AuditChange[] = [];
  const order = [
    ...ids,
    ...[...after.keys()].filter(k => !named.has(k) && !cascaded.includes(k)),
    ...cascaded,
  ];
  for (const k of order) {
    const t0 = before.get(k)!;
    const t = after.get(k)!;
    const u = updates.find(x => x.id === k);
    for (const [column, field] of Object.entries(COLUMN_FIELD) as Array<
      [Column, string]
    >) {
      if (t[column] !== t0[column] || (u && u[field as Field] !== undefined)) {
        changes.push({
          id: k,
          field,
          before: t0[column] ?? null,
          after: t[column] ?? null,
        });
      }
    }
  }
  if (changes.length === 0) {
    throw new Refusal('No field to change.');
  }
  // Each override actually used, on the reconciled row it overrides
  const reconciledOverridden = unique(overridden);
  for (const k of reconciledOverridden) {
    changes.push({
      id: k,
      field: 'allow_reconciled',
      before: null,
      after: true,
    });
  }

  return {
    ids,
    sends,
    changes,
    partners: cascaded,
    reconciledOverridden,
  };
}
