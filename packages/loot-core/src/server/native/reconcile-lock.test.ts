// Fork-only (sc-4825, openspec/changes/native-reconcile-resolve-and-lock).
// Steps 3 and 4: matches, search, the limits, the lock preview, the
// adjustment and the lock. Swift decodes the fixtures this file writes.
import { lockPlan } from '#server/accounts/reconcile-plan';
import { clearedBalanceOf } from '#server/accounts/statement-balance';
import { installAPI } from '#server/api';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import {
  insertRule,
  loadRules,
  resetState,
} from '#server/transactions/transaction-rules';
import { clearUndo, undoTargetMeta } from '#server/undo';
import { q } from '#shared/query';
import { ungroupTransactions, updateTransaction } from '#shared/transactions';
import { applyChanges } from '#shared/util';
import type { TransactionEntity } from '#types/models';

import { app } from './app';
import { addAmountParam, lockAccount, readLimit } from './reconcile-lock';

const h = app.handlers;
const MCP_RECONCILIATION = new URL(
  '../../../../mcp/src/tools/read/reconciliation.ts',
  import.meta.url,
).pathname;

// The MCP module imports the API client; its pure selection needs none of it
vi.mock('@actual-app/api', () => ({}));
const HOUR = 3_600_000;

const setPref = (id: string, value: string) =>
  db.update('preferences', { id, value });
const record = (amount: number, over: Record<string, unknown> = {}) =>
  setPref(
    'statement-balance-checking',
    JSON.stringify({
      id: 'r1',
      amount,
      source: 'entered',
      as_of: '2017-01-01',
      entered_at: Date.now() - HOUR,
      entered_by: 'Ken',
      consumed_at: null,
      ...over,
    }),
  );
const storedRecord = async () =>
  JSON.parse(
    (
      await db.first<{ value: string }>(
        "SELECT value FROM preferences WHERE id = 'statement-balance-checking'",
      )
    )?.value ?? 'null',
  );
const row = (id: string) =>
  db.first<{ cleared: number; reconciled: number; tombstone: number }>(
    'SELECT cleared, reconciled, tombstone FROM transactions WHERE id = ?',
    [id],
  );
const lastReconciled = async () =>
  (
    await db.first<{ last_reconciled: string | null }>(
      "SELECT last_reconciled FROM accounts WHERE id = 'checking'",
    )
  )?.last_reconciled ?? null;

async function tx(
  id: string,
  amount: number,
  over: Record<string, unknown> = {},
) {
  await db.insertTransaction({
    id,
    account: 'checking',
    date: '2016-12-20',
    amount,
    cleared: false,
    ...over,
  });
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  resetState();
  await loadMappings();
  await loadRules();
  global.currentMonth = '2017-01';
  await db.insertAccount({ id: 'checking', name: 'Checking' });
  await db.insertAccount({ id: 'savings', name: 'Savings' });
  await db.insertAccount({ id: 'brokerage', name: 'Brokerage', offbudget: 1 });
  await db.insertPayee({ id: 'grocer', name: 'Grocer' });
  await db.insertPayee({
    id: 'to-savings',
    name: '',
    transfer_acct: 'savings',
  });
  await db.insertPayee({
    id: 'to-checking',
    name: '',
    transfer_acct: 'checking',
  });
  await db.insertCategoryGroup({ id: 'g', name: 'Bills' });
  await db.insertCategory({ id: 'misc', name: 'Misc', cat_group: 'g' });
  await db.insertCategory({ id: 'other', name: 'Other', cat_group: 'g' });
  clearUndo();
});

afterEach(() => {
  global.currentMonth = null;
});

// One fixture for the parity contract (design D1)
async function seedPlan() {
  await tx('paid', 100000, { cleared: true, date: '2016-12-01' });
  await tx('open', -2500, { date: '2016-12-02' });
  await tx('old', 5000, { cleared: true, reconciled: true });
  await tx('split', -3000, { cleared: true, is_parent: true });
  await tx('split-a', -1000, {
    cleared: true,
    is_child: true,
    parent_id: 'split',
  });
  await tx('split-b', -2000, {
    cleared: true,
    is_child: true,
    parent_id: 'split',
  });
  // A reconciled parent whose child is not reconciled
  await tx('done-split', -800, {
    cleared: true,
    reconciled: true,
    is_parent: true,
  });
  await tx('done-a', -800, {
    cleared: true,
    reconciled: false,
    is_child: true,
    parent_id: 'done-split',
  });
  await tx('xfer', -700, {
    cleared: true,
    payee: 'to-savings',
    transfer_id: 'xfer-b',
  });
  await db.insertTransaction({
    id: 'xfer-b',
    account: 'savings',
    date: '2016-12-20',
    amount: 700,
    cleared: false,
    payee: 'to-checking',
    transfer_id: 'xfer',
  });
}

describe('lockPlan (D1)', () => {
  it('selects what the MCP and the web lock select', async () => {
    await seedPlan();
    const plan = await lockPlan('checking');
    const ours = [...plan.ids].sort();

    // The MCP's own selection (packages/mcp/src/tools/read/reconciliation.ts),
    // loaded by path so loot-core's typecheck stays out of the MCP package
    const { data: all } = await aqlQuery(
      q('transactions')
        .filter({ account: 'checking' })
        .options({ splits: 'all' })
        .select([
          'id',
          'account',
          'date',
          'amount',
          'cleared',
          'reconciled',
          'transfer_id',
          'parent_id',
          'is_child',
        ]),
    );
    const { reconciliation } = (await import(
      /* @vite-ignore */ MCP_RECONCILIATION
    )) as {
      reconciliation: (rows: unknown[]) => {
        selected: { id: string }[];
        children: { id: string }[];
        skippedChildren: string[];
      };
    };
    const fromMcp = reconciliation(all as unknown[]);
    const mcp = [...fromMcp.selected, ...fromMcp.children]
      .map(r => r.id)
      .sort();
    const mcpSkipped = fromMcp.skippedChildren;

    // The web's lockTransactions (desktop-client/src/accounts/reconciliation.ts)
    const { data: grouped } = await aqlQuery(
      q('transactions')
        .filter({ cleared: true, reconciled: false, account: 'checking' })
        .select('*')
        .options({ splits: 'grouped' }),
    );
    let transactions = ungroupTransactions(grouped as TransactionEntity[]);
    const web = new Set<string>();
    for (const trans of [...transactions]) {
      const { diff } = updateTransaction(transactions, {
        ...trans,
        reconciled: true,
      });
      transactions = applyChanges(diff, transactions);
      diff.updated.forEach(u => u.id && web.add(u.id));
    }

    expect(ours).toEqual(['paid', 'split', 'split-a', 'split-b', 'xfer']);
    expect(ours).toEqual(mcp);
    // The web also locks an unreconciled child of an already reconciled
    // parent; the MCP and lockPlan skip it (design D1 names it skipped).
    // Everything else is the same set.
    expect(plan.skippedChildren).toEqual(['done-a']);
    expect(ours).toEqual(
      [...web].filter(id => !plan.skippedChildren.includes(id)).sort(),
    );
    expect(plan.skippedChildren).toEqual(mcpSkipped);
    expect(plan.partners.map(p => p.id)).toEqual(['xfer-b']);
  });
});

describe('the limit preferences (D7)', () => {
  it.each([
    [undefined, 300],
    ['50', 50],
    ['2000', 2000],
    ['2001', 300],
    ['0', 300],
    ['1e1', 300],
    ['0x7', 300],
    [' 7', 300],
  ])('reconcile-match-max-candidates %j reads %i', async (value, expected) => {
    if (value !== undefined) {
      await setPref('reconcile-match-max-candidates', value);
    }
    expect(await readLimit('reconcile-match-max-candidates')).toBe(expected);
  });

  it('has defaults and ceilings for each', async () => {
    expect(await readLimit('reconcile-match-max-results')).toBe(5);
    expect(await readLimit('reconcile-lock-list-max-rows')).toBe(200);
    await setPref('reconcile-match-max-results', '20');
    await setPref('reconcile-lock-list-max-rows', '2000');
    expect(await readLimit('reconcile-match-max-results')).toBe(20);
    expect(await readLimit('reconcile-lock-list-max-rows')).toBe(2000);
    await setPref('reconcile-match-max-results', '21');
    expect(await readLimit('reconcile-match-max-results')).toBe(5);
  });
});

describe('native/reconcile-matches (D2)', () => {
  const matches = () =>
    h['native/reconcile-matches']({ account_id: 'checking' });

  it('orders a single, then a pair, then an untick, nearest date first', async () => {
    await tx('base', 100000, { cleared: true, date: '2016-11-01' });
    await tx('one-old', 4180, { date: '2016-12-01' });
    await tx('one-new', 4180, { date: '2016-12-20' });
    await tx('pair-a', 3000, { date: '2016-12-10' });
    await tx('pair-b', 1180, { date: '2016-12-11' });
    await tx('wrong', -4180, { cleared: true, date: '2016-12-05' });
    await tx('future', 4180, { date: '2017-02-01' });
    // Cleared is 100000 - 4180, so the difference is 4180
    await record(100000);

    const result = await matches();
    expect(result.difference).toBe(4180);
    expect(result.matches.map(m => [m.kind, m.ids])).toEqual([
      ['tick-one', ['one-new']],
      ['tick-one', ['one-old']],
      ['tick-two', ['pair-b', 'pair-a']],
      ['untick-one', ['wrong']],
    ]);
    expect(result.matches[2].amounts).toEqual([1180, 3000]);
    expect(result.add_amount_param).toBe('-41.80');
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/reconcile-matches.json',
    );
  });

  it('caps results and candidates, the candidates before the pair search', async () => {
    await record(1000);
    for (let i = 0; i < 8; i++) {
      await tx(`r${i}`, 1000, { date: `2016-12-${String(10 + i)}` });
    }
    expect((await matches()).matches).toHaveLength(5);
    await setPref('reconcile-match-max-results', '2');
    expect((await matches()).matches).toHaveLength(2);

    await setPref('reconcile-match-max-results', '20');
    // A pair whose older half is past the candidates cap is not found
    await tx('p-old', 400, { date: '2016-01-01' });
    await tx('p-new', 600, { date: '2016-12-30' });
    await setPref('reconcile-match-max-candidates', '9');
    expect((await matches()).matches.some(m => m.ids.includes('p-old'))).toBe(
      false,
    );
    await setPref('reconcile-match-max-candidates', '10');
    expect((await matches()).matches.some(m => m.ids.includes('p-old'))).toBe(
      true,
    );
  });

  it('has nothing to offer without a record or at zero', async () => {
    await tx('a', 4180);
    expect((await matches()).matches).toEqual([]);
    await record(0);
    expect((await matches()).matches).toEqual([]);
  });

  it.each([
    [-4180, '41.80'],
    [4180, '-41.80'],
    [5, '-0.05'],
    [-123456, '1234.56'],
  ])('the add form amount for %i is %s (D2, the form negates it)', (d, s) => {
    expect(addAmountParam(d, 2)).toBe(s);
  });
});

describe('native/reconcile-rows search (D2)', () => {
  const search = (text: string) =>
    h['native/reconcile-rows']({
      account_id: 'checking',
      scope: 'all',
      search: text,
    });

  beforeEach(async () => {
    await tx('a', -4180, { payee: 'grocer' });
    await tx('b', -4108);
    await tx('c', 4810, { cleared: true });
    await tx('d', -1234, { notes: 'Save 50% now' });
    await tx('e', -999, { notes: 'Save 50 now' });
    await tx('f', -500, { notes: 'a_b' });
    await tx('g', -501, { notes: 'axb' });
  });

  it('finds an amount and its swapped digits', async () => {
    const ids = (await search('41.80')).rows.map(r => r.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('finds payee and notes text, case-insensitive', async () => {
    expect((await search('GROC')).rows.map(r => r.id)).toEqual(['a']);
  });

  it('matches % and _ literally', async () => {
    expect((await search('50%')).rows.map(r => r.id)).toEqual(['d']);
    expect((await search('a_b')).rows.map(r => r.id)).toEqual(['f']);
    expect((await search("'; DROP TABLE x; --")).rows).toEqual([]);
  });

  it('fails on text over 100 characters or not a string', async () => {
    await expect(search('x'.repeat(101))).rejects.toThrow(/100/);
    await expect(search(42 as never)).rejects.toThrow();
  });
});

describe('native/reconcile-lock-preview (D3)', () => {
  const preview = () =>
    h['native/reconcile-lock-preview']({ account_id: 'checking' });

  it('lists the rows, the partners and the counts, matching the fixture', async () => {
    await seedPlan();
    await record(await clearedBalanceOf('checking'));
    const result = await preview();
    expect(result.count).toBe(3);
    expect(result.child_count).toBe(2);
    expect(result.rows.map(r => r.id)).toEqual(['split', 'xfer', 'paid']);
    expect(result.partners).toEqual([
      expect.objectContaining({
        id: 'xfer-b',
        account: 'Savings',
        amount: 700,
      }),
    ]);
    expect(result.skipped_children).toEqual(['done-a']);
    expect(result.truncated).toBe(false);
    expect(result.record?.amount).toBe(await clearedBalanceOf('checking'));
    expect(result.plan_digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      JSON.stringify(
        { ...result, record: { ...result.record, entered_at: 0 } },
        null,
        2,
      ) + '\n',
    ).toMatchFileSnapshot('./fixtures/reconcile-lock-preview.json');
  });

  it('cuts the list at the limit with exact counts', async () => {
    for (let i = 0; i < 5; i++) await tx(`c${i}`, 100, { cleared: true });
    await setPref('reconcile-lock-list-max-rows', '2');
    const result = await preview();
    expect(result.rows).toHaveLength(2);
    expect(result.count).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('changes the digest when a row, a partner or the balance changes', async () => {
    await seedPlan();
    await record(1);
    const first = (await preview()).plan_digest;
    expect((await preview()).plan_digest).toBe(first);
    await db.updateTransaction({ id: 'xfer-b', amount: 701 });
    const second = (await preview()).plan_digest;
    expect(second).not.toBe(first);
    await db.updateTransaction({ id: 'open', cleared: true });
    const third = (await preview()).plan_digest;
    expect(third).not.toBe(second);
    await record(2);
    expect((await preview()).plan_digest).not.toBe(third);
  });
});

describe('native/reconcile-adjust (D4)', () => {
  const adjust = (over: Record<string, unknown> = {}) =>
    h['native/reconcile-adjust']({
      account_id: 'checking',
      amount: 4180,
      label: 'Reconciliation balance adjustment',
      undoToken: 'A',
      ...over,
    } as never);
  const adjustments = () =>
    db.all<{
      id: string;
      amount: number;
      category: string | null;
      cleared: number;
      date: number;
      notes: string;
    }>(
      "SELECT id, amount, category, cleared, date, notes FROM v_transactions_internal_alive WHERE account = 'checking' AND notes LIKE 'Reconciliation%'",
    );

  beforeEach(async () => {
    await tx('paid', 100000, { cleared: true });
  });

  it('needs a usable record and the live difference', async () => {
    await expect(adjust()).rejects.toThrow(/record/);
    await record(104180, { consumed_at: Date.now() });
    await expect(adjust()).rejects.toThrow(/record/);
    await record(104180);
    await expect(adjust({ amount: 4100 })).rejects.toThrow(/difference/);
    expect(await adjustments()).toEqual([]);
  });

  it('creates the row as the app does and returns a zero difference', async () => {
    await record(104180);
    const result = await adjust();
    expect(result.summary.difference).toBe(0);
    const [created] = await adjustments();
    expect(created).toMatchObject({
      amount: 4180,
      cleared: 1,
      date: 20170101,
      notes: 'Reconciliation balance adjustment',
    });
    expect(result.id).toBe(created.id);
  });

  it('runs the rules, and an explicit category wins', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'notes', op: 'contains', value: 'Reconciliation' }],
      actions: [{ op: 'set', field: 'category', value: 'other' }],
    });
    await record(104180);
    await adjust();
    expect((await adjustments())[0].category).toBe('other');
    await h['native/undo']({ token: 'A' });
    await adjust({ category_id: 'misc', undoToken: 'B' });
    expect((await adjustments())[0].category).toBe('misc');
  });

  it.each([
    [{ category_id: 'nope' }],
    [{ category_id: 'g' }],
    [{ label: '' }],
    [{ label: 'x'.repeat(101) }],
    [{ label: 7 }],
    [{ undoToken: '' }],
    [{ amount: 41.8 }],
  ])('refuses %j and creates nothing', async over => {
    await record(104180);
    await expect(adjust(over)).rejects.toThrow();
    expect(await adjustments()).toEqual([]);
  });

  it('refuses a deleted category and a category on an off-budget account', async () => {
    await record(104180);
    await db.deleteCategory({ id: 'misc' });
    await expect(adjust({ category_id: 'misc' })).rejects.toThrow(/category/);
    await setPref(
      'statement-balance-brokerage',
      JSON.stringify({
        id: 'rb',
        amount: 100,
        source: 'entered',
        as_of: null,
        entered_at: Date.now(),
        entered_by: 'Ken',
        consumed_at: null,
      }),
    );
    await expect(
      adjust({ account_id: 'brokerage', amount: 100, category_id: 'other' }),
    ).rejects.toThrow(/off-budget/);
    expect(await adjustments()).toEqual([]);
  });

  it('is one undo step', async () => {
    await record(104180);
    await adjust();
    await h['native/undo']({ token: 'A' });
    expect(await adjustments()).toEqual([]);
  });
});

describe('native/reconcile-lock (D5)', () => {
  const preview = () =>
    h['native/reconcile-lock-preview']({ account_id: 'checking' });
  const lock = (plan_digest: string) =>
    h['native/reconcile-lock']({ account_id: 'checking', plan_digest });

  it('refuses without a usable record or at a non-zero difference', async () => {
    await seedPlan();
    const digest = (await preview()).plan_digest;
    await expect(lock(digest)).rejects.toThrow(/record/);
    await record(1);
    await expect(lock((await preview()).plan_digest)).rejects.toThrow(
      /difference/,
    );
    expect((await row('paid'))?.reconciled).toBe(0);
  });

  it('refuses a stale digest and changes nothing', async () => {
    await seedPlan();
    await record(await clearedBalanceOf('checking'));
    const digest = (await preview()).plan_digest;
    await db.updateTransaction({ id: 'xfer-b', amount: 701 });
    await expect(lock(digest)).rejects.toThrow(/changed since/);
    expect((await row('paid'))?.reconciled).toBe(0);
    expect((await storedRecord()).consumed_at).toBeNull();
  });

  it('locks only the plan in one step, consumes and stamps when verified', async () => {
    await seedPlan();
    await record(await clearedBalanceOf('checking'));
    const result = await lock((await preview()).plan_digest);
    expect(result.locked_ids.sort()).toEqual([
      'paid',
      'split',
      'split-a',
      'split-b',
      'xfer',
    ]);
    expect(result.linked_ids).toEqual(['xfer-b']);
    expect(result.verified).toBe(true);
    for (const id of result.locked_ids) {
      expect((await row(id))?.reconciled).toBe(1);
    }
    expect((await row('open'))?.reconciled).toBe(0);
    expect((await row('xfer-b'))?.reconciled).toBe(0);
    expect((await row('done-a'))?.reconciled).toBe(0);
    expect((await storedRecord()).consumed_at).not.toBeNull();
    expect(await lastReconciled()).toMatch(/^\d+$/);
  });

  it('stamps and consumes a verified zero-row lock', async () => {
    await record(0);
    const result = await lock((await preview()).plan_digest);
    expect(result.locked_ids).toEqual([]);
    expect(result.verified).toBe(true);
    expect((await storedRecord()).consumed_at).not.toBeNull();
    expect(await lastReconciled()).not.toBeNull();
  });

  it('consumes but does not stamp when the balance moved while locking', async () => {
    await seedPlan();
    await record(await clearedBalanceOf('checking'));
    const digest = (await preview()).plan_digest;
    // A cleared row lands between the lock's write and its re-read
    const result = await lockAccount('checking', digest, async () => {
      await tx('late', 999, { cleared: true });
    });
    expect(result.verified).toBe(false);
    expect(result.difference).toBe(-999);
    expect((await row('paid'))?.reconciled).toBe(1);
    expect((await storedRecord()).consumed_at).not.toBeNull();
    expect(await lastReconciled()).toBeNull();
  });

  it('cannot be undone through the bridge, nor anything before it', async () => {
    await tx('paid', 100000, { cleared: true });
    await record(104180);
    await h['native/reconcile-adjust']({
      account_id: 'checking',
      amount: 4180,
      label: 'Reconciliation balance adjustment',
      undoToken: 'A',
    });
    await lock((await preview()).plan_digest);
    const marker = undoTargetMeta() as { nativeUndoToken?: unknown };
    expect(marker?.nativeUndoToken).toBeUndefined();
    for (const token of ['A', '', 'undefined', 'null']) {
      await expect(h['native/undo']({ token })).rejects.toThrow(
        /nothing to undo/,
      );
    }
    expect((await row('paid'))?.reconciled).toBe(1);
    expect(
      (
        await h['native/reconcile-rows']({
          account_id: 'checking',
          scope: 'all',
        })
      ).summary.cleared,
    ).toBe(104180);
  });

  it('is exposed by no api/ handler', () => {
    const names = Object.keys(installAPI({} as never));
    expect(names.length).toBeGreaterThan(10);
    expect(names.some(n => /reconcile-(lock|adjust)/.test(n))).toBe(false);
  });
});
