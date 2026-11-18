// Fork-only (sc-4825, openspec/changes/native-reconcile-resolve-and-lock).
// Reconcile steps 3 and 4 for native screens: likely matches, the lock
// preview, the adjustment and the lock. Every amount, difference and row set
// is loot-core's; Swift only shows them. The contract is
// reconcile-lock.test.ts and its fixtures.
import { lockPlan } from '#server/accounts/reconcile-plan';
import type { LockPlan } from '#server/accounts/reconcile-plan';
import {
  clearedBalanceOf,
  consumeStatementBalance,
  getStatementBalance,
} from '#server/accounts/statement-balance';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { toDateRepr } from '#server/models';
import { batchUpdateTransactions } from '#server/transactions';
import { runRules } from '#server/transactions/transaction-rules';
import { getCurrency } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import { realizeTempTransactions } from '#shared/transactions';
import type { TransactionEntity } from '#types/models';

import { readLimit } from './limits';
import { isUsable, openAccount, summaryOf } from './reconcile';
import type { NativeReconcileRow, NativeReconcileSummary } from './reconcile';

/** The budget's currency places, as the web formats money. */
export async function decimalPlaces() {
  const code = (
    await db.first<{ value: string | null }>(
      "SELECT value FROM preferences WHERE id = 'defaultCurrencyCode'",
    )
  )?.value;
  return getCurrency(code ?? '').decimalPlaces;
}

/**
 * The add form's `amount` parameter for a difference (D2): a decimal the form
 * negates, so the form shows the difference itself. Integer arithmetic only.
 */
export function addAmountParam(difference: number, places: number): string {
  const sign = difference > 0 ? '-' : '';
  const digits = String(Math.abs(difference)).padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  return places > 0 ? `${sign}${whole}.${digits.slice(-places)}` : sign + whole;
}

type Candidate = { id: string; date: string; amount: number; cleared: boolean };

/** B1's row shape for `ids`, in that order (the shared Transaction row's fields). */
async function loadRows(ids: string[]): Promise<NativeReconcileRow[]> {
  if (ids.length === 0) return [];
  const { data } = (await aqlQuery(
    q('transactions')
      .filter({ id: { $oneof: ids } })
      .options({ splits: 'none' })
      .select([
        'id',
        'date',
        { payee: 'payee.name' },
        { category: 'category.name' },
        'notes',
        'amount',
        'cleared',
        'reconciled',
        'is_parent',
      ]),
  )) as {
    data: (Omit<NativeReconcileRow, 'isParent'> & { is_parent: boolean })[];
  };
  const byId = new Map(data.map(r => [r.id, r]));
  return ids.flatMap(id => {
    const r = byId.get(id);
    if (!r) return [];
    const { is_parent, ...rest } = r;
    return [
      {
        ...rest,
        payee: rest.payee ?? null,
        category: rest.category ?? null,
        notes: rest.notes ?? null,
        cleared: Boolean(rest.cleared),
        reconciled: Boolean(rest.reconciled),
        isParent: Boolean(is_parent),
      },
    ];
  });
}

export type NativeReconcileMatch = {
  kind: 'tick-one' | 'tick-two' | 'untick-one';
  ids: string[];
  amounts: number[];
  // The rows themselves, for the shared Transaction row (PR 403 review)
  rows: NativeReconcileRow[];
};

/**
 * Step 3's likely matches (D2): a row equal to the difference, two summing to
 * it, a cleared row equal to its negative; singles, pairs, unticks, nearest
 * date first. Candidates are capped before the pair search.
 */
export async function reconcileMatches({
  account_id,
}: {
  account_id: string;
}): Promise<{
  difference: number | null;
  matches: NativeReconcileMatch[];
  add_amount_param: string | null;
}> {
  const account = await openAccount(account_id);
  const { difference } = await summaryOf(account);
  if (!difference) {
    return { difference, matches: [], add_amount_param: null };
  }
  const max = await readLimit('reconcile-match-max-results');
  const { data } = (await aqlQuery(
    q('transactions')
      .filter({
        account,
        reconciled: false,
        date: { $lte: monthUtils.currentDay() },
      })
      .options({ splits: 'none' })
      .select(['id', 'date', 'amount', 'cleared'])
      .orderBy([{ date: 'desc' }, { sort_order: 'desc' }, 'id'])
      .limit(await readLimit('reconcile-match-max-candidates')),
  )) as { data: Candidate[] };

  const uncleared = data.filter(r => !r.cleared);
  const singles = uncleared.filter(r => r.amount === difference);
  // Linear: each row looks for its other half among the more recent ones
  const pairs: Candidate[][] = [];
  const seen = new Map<number, Candidate[]>();
  for (const r of uncleared) {
    if (r.amount !== difference) {
      for (const other of seen.get(difference - r.amount) ?? []) {
        pairs.push([other, r]);
        if (pairs.length >= max) break;
      }
    }
    if (pairs.length >= max) break;
    seen.set(r.amount, [...(seen.get(r.amount) ?? []), r]);
  }
  const unticks = data.filter(r => r.cleared && r.amount === -difference);

  const found = [
    ...singles.map(r => ({ kind: 'tick-one' as const, rows: [r] })),
    ...pairs.map(rows => ({ kind: 'tick-two' as const, rows })),
    ...unticks.map(r => ({ kind: 'untick-one' as const, rows: [r] })),
  ].slice(0, max);
  const details = new Map(
    (
      await loadRows([...new Set(found.flatMap(m => m.rows.map(r => r.id)))])
    ).map(r => [r.id, r]),
  );
  const matches: NativeReconcileMatch[] = found.map(({ kind, rows }) => ({
    kind,
    ids: rows.map(r => r.id),
    amounts: rows.map(r => r.amount),
    rows: rows.flatMap(r => details.get(r.id) ?? []),
  }));

  return {
    difference,
    matches,
    add_amount_param: addAmountParam(difference, await decimalPlaces()),
  };
}

const MAX_SEARCH = 100;

/** Two adjacent digits swapped, on the amount's minor-unit digits. */
function swappedAmounts(minor: number, places: number) {
  const digits = String(minor).padStart(places + 1, '0');
  const out = new Set<number>();
  for (let i = 0; i < digits.length - 1; i++) {
    const swapped =
      digits.slice(0, i) + digits[i + 1] + digits[i] + digits.slice(i + 2);
    out.add(parseInt(swapped, 10));
  }
  return [...out];
}

/**
 * The ids `search` finds in the account (D2): an amount (and its digit
 * swaps), else payee and notes text. Bound as parameters; % _ and \ escaped,
 * so the text is matched literally.
 */
export async function searchIds(
  account: string,
  search: unknown,
): Promise<string[]> {
  if (typeof search !== 'string' || search.length > MAX_SEARCH) {
    throw new Error(
      `native/reconcile-rows: search must be text of at most ${MAX_SEARCH} characters`,
    );
  }
  const text = search.trim();
  const today = toDateRepr(monthUtils.currentDay());
  const places = await decimalPlaces();
  const numeric = text.replace(/^[^\d.-]+/, '').replace(/,/g, '');
  // A 0-place currency (JPY) takes no fraction, so "41.8" is not 418
  const pattern = new RegExp(
    places > 0 ? `^-?\\d{1,12}(\\.\\d{1,${places}})?$` : '^-?\\d{1,12}$',
  );
  const base = `SELECT t.id FROM v_transactions_internal_alive t
    LEFT JOIN payees p ON p.id = t.payee
    WHERE t.account = ? AND t.is_child = 0 AND t.date <= ?`;
  if (text && pattern.test(numeric)) {
    const [whole, fraction = ''] = numeric.replace('-', '').split('.');
    const minor = parseInt(whole + fraction.padEnd(places, '0'), 10);
    const amounts = [...new Set([minor, ...swappedAmounts(minor, places)])];
    const signed = amounts.flatMap(a => [a, -a]);
    const rows = await db.all<{ id: string }>(
      `${base} AND t.amount IN (${signed.map(() => '?').join(',')})`,
      [account, today, ...signed],
    );
    return rows.map(r => r.id);
  }
  const like = `%${text.toLowerCase().replace(/[\\%_]/g, c => `\\${c}`)}%`;
  const rows = await db.all<{ id: string }>(
    `${base} AND (LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(t.notes) LIKE ? ESCAPE '\\')`,
    [account, today, like, like],
  );
  return rows.map(r => r.id);
}

async function digestOf(
  plan: LockPlan,
  cleared: number,
  record: { id: string; amount: number } | null,
) {
  const text = JSON.stringify({
    rows: [...plan.rows, ...plan.children].map(r => [
      r.id,
      r.amount,
      r.date,
      r.cleared,
      r.reconciled,
      r.transfer_id,
      r.parent_id,
    ]),
    skipped: plan.skippedChildren,
    partners: plan.partners.map(p => [p.id, p.amount, p.date, p.reconciled]),
    cleared,
    record: record && [record.id, record.amount],
  });
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function usableRecord(account: string) {
  const record = await getStatementBalance({ account_id: account });
  return record && isUsable(record) ? record : null;
}

export type NativeLockPreview = {
  rows: NativeReconcileRow[];
  // Rows the button locks, split parents counted once; children follow them
  count: number;
  child_count: number;
  truncated: boolean;
  partners: LockPlan['partners'];
  skipped_children: string[];
  record: { amount: number; source: string; entered_at: number } | null;
  plan_digest: string;
};

/** Step 4 (D3): what the lock writes, bound by a digest over all of it. */
export async function reconcileLockPreview({
  account_id,
}: {
  account_id: string;
}): Promise<NativeLockPreview> {
  const account = await openAccount(account_id);
  const plan = await lockPlan(account);
  const record = await usableRecord(account);
  const cleared = await clearedBalanceOf(account);
  const max = await readLimit('reconcile-lock-list-max-rows');
  const listed = plan.rows.slice(0, max).map(r => r.id);
  return {
    rows: await loadRows(listed),
    count: plan.rows.length,
    child_count: plan.children.length,
    truncated: plan.rows.length > listed.length,
    partners: plan.partners,
    skipped_children: plan.skippedChildren,
    record: record && {
      amount: record.amount,
      source: record.source,
      entered_at: record.entered_at,
    },
    plan_digest: await digestOf(plan, cleared, record),
  };
}

/**
 * A person's adjustment (D4): only at the live difference, created as the
 * app's createReconciliationTransaction does, then the rules, then an explicit
 * category. One undo step (registered undoable with the token).
 */
export async function reconcileAdjust(args: {
  account_id: string;
  amount: number;
  category_id?: string | null;
  label: string;
  undoToken: string;
}): Promise<{ id: string; summary: NativeReconcileSummary }> {
  const { account_id, amount, category_id, label, undoToken } =
    args ?? ({} as typeof args);
  if (typeof undoToken !== 'string' || !undoToken) {
    throw new Error(
      'native/reconcile-adjust: a native write needs its undo token',
    );
  }
  if (typeof label !== 'string' || label.length < 1 || label.length > 100) {
    throw new Error(
      'native/reconcile-adjust: the label must be 1 to 100 characters',
    );
  }
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new Error('native/reconcile-adjust: the amount must be whole cents');
  }
  const account = await openAccount(account_id);
  if (!(await usableRecord(account))) {
    throw new Error('native/reconcile-adjust: no usable recorded balance');
  }
  const { difference } = await summaryOf(account);
  if (amount !== difference) {
    throw new Error(
      'native/reconcile-adjust: the amount is not the difference any more',
    );
  }
  if (category_id != null) {
    if (typeof category_id !== 'string') {
      throw new Error('native/reconcile-adjust: no such category');
    }
    const { offbudget } =
      (await db.first<{ offbudget: number }>(
        'SELECT offbudget FROM accounts WHERE id = ?',
        [account],
      )) ?? {};
    if (offbudget) {
      throw new Error(
        'native/reconcile-adjust: an off-budget account takes no category',
      );
    }
    const category = await db.first<{ id: string }>(
      'SELECT id FROM categories WHERE id = ? AND tombstone = 0',
      [category_id],
    );
    if (!category) throw new Error('native/reconcile-adjust: no such category');
  }

  const [draft] = realizeTempTransactions([
    {
      id: 'temp',
      account,
      cleared: true,
      reconciled: false,
      amount,
      date: monthUtils.currentDay(),
      notes: label,
    } as TransactionEntity,
  ]);
  const ruled = (await runRules(draft)) as TransactionEntity;
  const created = {
    ...ruled,
    ...(category_id ? { category: category_id } : {}),
  };
  await batchUpdateTransactions({ added: [created] });
  return { id: created.id, summary: await summaryOf(account) };
}

export type NativeLockResult = {
  locked_ids: string[];
  linked_ids: string[];
  verified: boolean;
  cleared: number;
  difference: number;
};

/**
 * The lock (D5), bound to the preview's digest. `afterWrite` is for tests: it
 * runs between the write and the re-read, where a sync could land.
 */
export async function lockAccount(
  account_id: string,
  plan_digest: string,
  afterWrite?: () => Promise<void>,
): Promise<NativeLockResult> {
  const account = await openAccount(account_id);
  const record = await usableRecord(account);
  if (!record) {
    throw new Error('native/reconcile-lock: no usable recorded balance');
  }
  const before = await clearedBalanceOf(account);
  if (record.amount !== before) {
    throw new Error('native/reconcile-lock: the difference is not zero');
  }
  const plan = await lockPlan(account);
  if (
    typeof plan_digest !== 'string' ||
    (await digestOf(plan, before, record)) !== plan_digest
  ) {
    throw new Error(
      'native/reconcile-lock: The account changed since this screen. Review it again. Nothing changed.',
    );
  }
  if (plan.ids.length > 0) {
    await batchUpdateTransactions({
      updated: plan.ids.map(id => ({ id, reconciled: true })),
    });
  }
  await afterWrite?.();
  const cleared = await clearedBalanceOf(account);
  const verified = cleared === record.amount;
  // As the MCP: consumed whenever rows locked; stamped only when verified
  if (plan.ids.length > 0 || verified) {
    await consumeStatementBalance({ account_id: account, id: record.id });
  }
  if (verified) {
    await db.update('accounts', {
      id: account,
      last_reconciled: String(Date.now()),
    });
  }
  return {
    locked_ids: plan.ids,
    linked_ids: plan.partners.map(p => p.id),
    verified,
    cleared,
    difference: record.amount - cleared,
  };
}

export function reconcileLock({
  account_id,
  plan_digest,
}: {
  account_id: string;
  plan_digest: string;
}) {
  return lockAccount(account_id, plan_digest);
}
