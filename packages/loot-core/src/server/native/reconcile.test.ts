import { app as accountsApp } from '#server/accounts/app';
import { clearedBalanceOf } from '#server/accounts/statement-balance';
// Fork-only (sc-4801, openspec/changes/native-reconcile-flow D5). The native
// reconcile handlers' contract: the Swift tests decode the fixtures this file
// writes. Regenerate with `vitest -u`.
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { clearUndo } from '#server/undo';

import { app } from './app';

const h = app.handlers;
const month = () => h['native/reconcile-month']();
const rows = (account_id: string, scope: 'to-tick' | 'all' = 'to-tick') =>
  h['native/reconcile-rows']({ account_id, scope });
const tick = (ids: string[], cleared = true, account_id = 'checking') =>
  h['native/reconcile-tick']({ account_id, ids, cleared, undoToken: 'T' });
const listSet = (excluded: unknown) =>
  h['native/reconcile-list-set']({ excluded } as never);

const HOUR = 3_600_000;
const cleared = async (id: string) =>
  (
    await db.first<{ cleared: number }>(
      'SELECT cleared FROM transactions WHERE id = ?',
      [id],
    )
  )?.cleared;
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

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  global.currentMonth = '2017-01';
  await db.insertAccount({ id: 'checking', name: 'Checking', sort_order: 1 });
  await db.insertAccount({ id: 'savings', name: 'Savings', sort_order: 2 });
  await db.insertAccount({ id: 'card', name: 'Card', sort_order: 3 });
  await db.insertAccount({ id: 'old', name: 'Old', closed: 1, sort_order: 4 });
  await db.insertPayee({ id: 'grocer', name: 'Grocer' });
  await db.insertCategoryGroup({ id: 'food-group', name: 'Food' });
  await db.insertCategory({
    id: 'groceries',
    name: 'Groceries',
    cat_group: 'food-group',
  });
  // currentDay() is 2017-01-01 in tests
  await db.insertTransaction({
    id: 'paid',
    account: 'checking',
    date: '2016-12-20',
    amount: 100000,
    cleared: true,
  });
  await db.insertTransaction({
    id: 'locked',
    account: 'checking',
    date: '2016-11-20',
    amount: 5000,
    cleared: true,
    reconciled: true,
  });
  await db.insertTransaction({
    id: 'food',
    account: 'checking',
    date: '2016-12-28',
    amount: -4180,
    payee: 'grocer',
    category: 'groceries',
    cleared: false,
  });
  await db.insertTransaction({
    id: 'split',
    account: 'checking',
    date: '2016-12-30',
    amount: -3000,
    is_parent: true,
    cleared: false,
  });
  for (const [id, amount] of [
    ['split-a', -1000],
    ['split-b', -2000],
  ] as const) {
    await db.insertTransaction({
      id,
      account: 'checking',
      date: '2016-12-30',
      amount,
      is_child: true,
      parent_id: 'split',
      cleared: false,
    });
  }
  await db.insertTransaction({
    id: 'future',
    account: 'checking',
    date: '2017-01-15',
    amount: -999,
    cleared: false,
  });
  await db.insertTransaction({
    id: 'other',
    account: 'savings',
    date: '2016-12-28',
    amount: -500,
    cleared: false,
  });
  clearUndo();
});

afterEach(() => {
  global.currentMonth = null;
});

describe('native/reconcile-month', () => {
  it('lists every open account as due by default, matching the fixture', async () => {
    const result = await month();
    expect(result.month).toBe('2017-01');
    expect(result.excluded).toEqual([]);
    expect(result.accounts.map(a => [a.id, a.status])).toEqual([
      ['checking', 'due'],
      ['savings', 'due'],
      ['card', 'due'],
    ]);
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/reconcile-month.json',
    );
  });

  it('reads done this month and in progress with an unexpired record', async () => {
    await db.update('accounts', {
      id: 'savings',
      last_reconciled: String(new Date(2017, 0, 1, 12).getTime()),
    });
    await db.update('accounts', {
      id: 'card',
      last_reconciled: String(new Date(2016, 11, 31).getTime()),
    });
    await record(95000);

    const statuses = Object.fromEntries(
      (await month()).accounts.map(a => [a.id, a.status]),
    );
    expect(statuses).toEqual({
      checking: 'in-progress',
      savings: 'done',
      card: 'due',
    });
  });

  it.each([
    ['consumed', { consumed_at: Date.now() }],
    ['expired', { entered_at: Date.now() - 200 * HOUR }],
  ])('a %s record is not in progress', async (_, over) => {
    await record(95000, over);
    expect((await month()).accounts[0].status).toBe('due');
  });

  it('leaves out excluded accounts and keeps the list', async () => {
    await setPref('reconcile-excluded-accounts', '["savings"]');
    const result = await month();
    expect(result.accounts.map(a => a.id)).toEqual(['checking', 'card']);
    expect(result.excluded).toEqual(['savings']);
    // Edit List re-adds by name; a closed or unknown id is not offered
    await setPref('reconcile-excluded-accounts', '["savings","old","gone"]');
    expect((await month()).hidden).toEqual([
      { id: 'savings', name: 'Savings' },
    ]);
  });

  it.each([
    'not json',
    '{"a":1}',
    '[1,2]',
    JSON.stringify(Array.from({ length: 501 }, (_, i) => `a${i}`)),
  ])('reads a malformed list %# as empty', async value => {
    await setPref('reconcile-excluded-accounts', value);
    const result = await month();
    expect(result.accounts).toHaveLength(3);
    expect(result.excluded).toEqual([]);
  });
});

describe('native/reconcile-rows', () => {
  it('lists uncleared rows up to today, parents only, matching the fixture', async () => {
    await record(95000);
    const result = await rows('checking');
    expect(result.rows.map(r => r.id)).toEqual(['split', 'food']);
    expect(result.rows[1].category).toBe('Groceries');
    expect(result.summary).toEqual({
      statement: 95000,
      cleared: 105000,
      difference: -10000,
    });
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/reconcile-rows.json',
    );
  });

  it('all flags reconciled rows', async () => {
    await db.insertTransaction({
      id: 'locked-now',
      account: 'checking',
      date: '2017-01-01',
      amount: 1,
      cleared: true,
      reconciled: true,
    });
    const result = await rows('checking', 'all');
    expect(result.rows.map(r => [r.id, r.reconciled])).toEqual([
      ['locked-now', true],
      ['split', false],
      ['food', false],
      ['paid', false],
    ]);
  });

  it('has no statement or difference without a usable record', async () => {
    await record(1, { consumed_at: Date.now() });
    expect((await rows('checking')).summary).toEqual({
      statement: null,
      cleared: 105000,
      difference: null,
    });
  });

  it('summary equals the cleared balance the MCP reads', async () => {
    expect((await rows('checking')).summary.cleared).toBe(
      await clearedBalanceOf('checking'),
    );
  });

  it('refuses an unknown or closed account', async () => {
    await expect(rows('nope')).rejects.toThrow(/account/);
    await expect(rows('old')).rejects.toThrow(/account/);
  });
});

describe('account-statement-balance-prefill for native', () => {
  it('matches the contract fixture', async () => {
    await db.update('accounts', {
      id: 'checking',
      account_sync_source: 'simpleFin',
      balance_current: 46541,
    });
    // Stamped by bank sync: written a day ago, so fresh
    await setPref('bank-balance-at-checking', String(Date.now() - 86_400_000));
    const result = await accountsApp.handlers[
      'account-statement-balance-prefill'
    ]({ account_id: 'checking' });
    expect(result.prefill?.amount).toBe(46541);
    // The write day depends on the clock: fixed for the fixture
    const fixed = {
      ...result,
      prefill: result.prefill && { ...result.prefill, as_of: '2016-12-31' },
    };
    await expect(JSON.stringify(fixed, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/statement-balance-prefill.json',
    );
  });
});

describe('native/reconcile-tick', () => {
  it('ticks a row and returns the new summary', async () => {
    await record(100820);
    const summary = await tick(['food']);
    expect(await cleared('food')).toBe(1);
    expect(summary).toEqual({
      statement: 100820,
      cleared: 100820,
      difference: 0,
    });
  });

  it("ticks one side of a transfer and leaves the other account's row", async () => {
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
    await db.insertTransaction({
      id: 'xfer',
      account: 'checking',
      date: '2016-12-29',
      amount: -2500,
      payee: 'to-savings',
      transfer_id: 'xfer-b',
      cleared: false,
    });
    await db.insertTransaction({
      id: 'xfer-b',
      account: 'savings',
      date: '2016-12-29',
      amount: 2500,
      payee: 'to-checking',
      transfer_id: 'xfer',
      cleared: false,
    });
    await tick(['xfer']);
    expect([await cleared('xfer'), await cleared('xfer-b')]).toEqual([1, 0]);
    await expect(tick(['xfer-b'])).rejects.toThrow();
  });

  it('a split parent sets its children', async () => {
    await tick(['split']);
    expect([
      await cleared('split'),
      await cleared('split-a'),
      await cleared('split-b'),
    ]).toEqual([1, 1, 1]);
    await tick(['split'], false);
    expect(await cleared('split-a')).toBe(0);
  });

  it.each([
    ['a lone split child', ['split-a']],
    ['a reconciled row', ['locked']],
    ["another account's row", ['food', 'other']],
    ['an unknown id', ['food', 'nope']],
  ])('refuses %s and changes nothing', async (_, ids) => {
    await expect(tick(ids)).rejects.toThrow();
    expect(await cleared('food')).toBe(0);
    expect(await cleared('locked')).toBe(1);
    expect(await cleared('other')).toBe(0);
  });

  it.each([
    [{ ids: [], cleared: true }],
    [{ ids: 'food', cleared: true }],
    [{ ids: [1], cleared: true }],
    [{ ids: ['food'], cleared: 'yes' }],
    [{ ids: ['food'], cleared: true, undoToken: '' }],
  ])('refuses malformed arguments %#', async args => {
    await expect(
      h['native/reconcile-tick']({
        account_id: 'checking',
        undoToken: 'T',
        ...args,
      } as never),
    ).rejects.toThrow();
    expect(await cleared('food')).toBe(0);
  });

  it('is one undo step for native/undo', async () => {
    await tick(['food', 'split']);
    await h['native/undo']({ token: 'T' });
    expect([
      await cleared('food'),
      await cleared('split'),
      await cleared('split-b'),
    ]).toEqual([0, 0, 0]);
  });
});

describe('native/reconcile-list-set', () => {
  it('writes only its preference, and the checklist follows', async () => {
    const before = await db.all<{ id: string; value: string }>(
      "SELECT id, value FROM preferences WHERE id != 'reconcile-excluded-accounts' ORDER BY id",
    );
    await listSet(['card']);
    expect((await month()).accounts.map(a => a.id)).toEqual([
      'checking',
      'savings',
    ]);
    expect(
      await db.all(
        "SELECT id, value FROM preferences WHERE id != 'reconcile-excluded-accounts' ORDER BY id",
      ),
    ).toEqual(before);

    await listSet([]);
    expect((await month()).accounts).toHaveLength(3);
  });

  it.each([
    'card',
    [1],
    { card: true },
    Array.from({ length: 501 }, (_, i) => `a${i}`),
  ])('refuses %#', async excluded => {
    await expect(listSet(excluded)).rejects.toThrow();
    expect(
      await db.first(
        "SELECT value FROM preferences WHERE id = 'reconcile-excluded-accounts'",
      ),
    ).toBeNull();
  });
});
