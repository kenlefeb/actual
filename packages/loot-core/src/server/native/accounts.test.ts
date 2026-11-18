// Fork-only (sc-4386, openspec/changes/native-accounts-screen D1 and D2). The
// contract for `native/accounts-list` and `native/account-register`: the Swift
// tests decode the fixtures this file writes. Regenerate with `vitest -u`.
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { app as schedulesApp } from '#server/schedules/app';
import { loadRules } from '#server/transactions/transaction-rules';
import { q } from '#shared/query';

import { app } from './app';

const h = app.handlers;
type Args = Parameters<(typeof h)['native/account-register']>[0];
const list = () => h['native/accounts-list']();
const register = (over: Partial<Args> = {}) =>
  h['native/account-register']({
    account_id: 'checking',
    scope: 'all',
    search: null,
    cursor: null,
    ...over,
  } as Args);
const setPref = (id: string, value: string) =>
  db.update('preferences', { id, value });
const encode = (value: unknown) => btoa(JSON.stringify(value));

async function web(filter: Record<string, unknown>) {
  const { data } = (await aqlQuery(
    q('transactions')
      .filter(filter)
      .options({ splits: 'none' })
      .calculate({ $sum: '$amount' }),
  )) as { data: number };
  return data;
}

async function addAccount(id: string, name: string, over = {}) {
  await db.insertAccount({ id, name, ...over });
  await db.insertPayee({ id: `to-${id}`, name, transfer_acct: id });
}

async function addTxn(id: string, over: Record<string, unknown> = {}) {
  await db.insertTransaction({
    id,
    account: 'checking',
    date: '2016-12-20',
    amount: -1000,
    cleared: false,
    ...over,
  });
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  global.currentMonth = '2017-01';
  await addAccount('checking', 'Checking');
  await addAccount('savings', 'Savings');
  await addAccount('card', 'Card');
  await addAccount('house', 'House', { offbudget: 1 });
  await addAccount('old', 'Old', { closed: 1 });
  await db.insertPayee({ id: 'grocer', name: 'Grocer' });
  await db.insertCategoryGroup({ id: 'food-group', name: 'Food' });
  await db.insertCategory({
    id: 'groceries',
    name: 'Groceries',
    cat_group: 'food-group',
  });
});

afterEach(() => {
  vi.useRealTimers();
  global.currentMonth = null;
});

describe('native/accounts-list', () => {
  beforeEach(async () => {
    await addTxn('c1', { amount: 100000, date: '2016-12-01', cleared: true });
    await addTxn('c2', { amount: -4180, date: '2016-12-28' });
    await addTxn('s1', { account: 'savings', amount: 50000 });
    await addTxn('k1', { account: 'card', amount: -25000 });
    await addTxn('h1', { account: 'house', amount: 300000 });
    await addTxn('o1', { account: 'old', amount: 700 });
    // A split parent and its children count once
    await addTxn('sp', { amount: -3000, is_parent: true });
    await addTxn('sp-a', { amount: -1000, is_child: true, parent_id: 'sp' });
    await addTxn('sp-b', { amount: -2000, is_child: true, parent_id: 'sp' });
    await db.insert('paychecks', {
      id: 'acme',
      name: 'Acme',
      definition: JSON.stringify({ clearingAccount: 'card' }),
    });
    await db.update('accounts', {
      id: 'checking',
      last_sync: '1483228800000',
      account_id: 'bank-1',
    });
  });

  it('matches the web bindings and the fixture', async () => {
    const result = await list();
    const byId = Object.fromEntries(
      [
        ...result.sections.onBudget.accounts,
        ...result.sections.offBudget.accounts,
        ...result.closed.accounts,
      ].map(a => [a.id, a]),
    );
    for (const id of ['checking', 'savings', 'card', 'house', 'old']) {
      expect(byId[id].balance).toBe(await web({ account: id }));
    }
    expect(result.sections.onBudget.total).toBe(
      await web({ 'account.offbudget': false, 'account.closed': false }),
    );
    expect(result.sections.offBudget.total).toBe(
      await web({ 'account.offbudget': true, 'account.closed': false }),
    );
    expect(result.closed.total).toBe(await web({ 'account.closed': true }));
    expect(result.netWorth).toBe(await web({ 'account.closed': false }));
    expect(result.sections.onBudget.accounts.map(a => a.id)).toEqual([
      'checking',
      'savings',
      'card',
    ]);
    expect(result.currencyCode).toBeDefined();
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/accounts-list.json',
    );
  });

  it('names the detail fields, the bank link and the paycheck clearing account', async () => {
    const { sections } = await list();
    const [checking, , card] = sections.onBudget.accounts;
    expect(checking).toMatchObject({
      lastSync: '1483228800000',
      lastTransactionDate: '2016-12-28',
      bankSync: true,
      clearingFor: null,
    });
    expect(card).toMatchObject({ bankSync: false, clearingFor: 'Acme' });
  });

  it('is empty without accounts', async () => {
    await global.emptyDatabase()();
    expect(await list()).toMatchObject({
      sections: { onBudget: { total: 0, accounts: [] } },
      closed: { total: 0, accounts: [] },
      netWorth: 0,
    });
  });
});

describe('native/account-register', () => {
  const ROWS = 130;
  async function seedMany() {
    for (let i = 0; i < ROWS; i++) {
      await addTxn(`m${String(i).padStart(3, '0')}`, {
        date: `2016-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 3) + 10)}`,
        sort_order: 1000 - i,
        amount: -(i + 1),
      });
    }
  }
  async function readAll(
    over: Partial<Args> = {},
    start: string | null = null,
  ) {
    const ids: string[] = [];
    let cursor: string | null = start;
    do {
      const page = await register({ ...over, cursor });
      ids.push(...page.rows.map(r => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  }

  // The web reads the transactions view, which orders by date desc,
  // starting_balance_flag, sort_order desc, id (aql/schema/index.ts)
  const webOrder = async (account = 'checking') => {
    const { data } = (await aqlQuery(
      q('transactions')
        .filter({ account })
        .select('id')
        .options({ splits: 'none' }),
    )) as { data: { id: string }[] };
    return data.map(r => r.id);
  };

  it('orders newest first as the web does and pages every row once', async () => {
    await seedMany();
    const ids = await readAll();
    expect(ids).toHaveLength(ROWS);
    expect(ids).toEqual(await webOrder());
  });

  it('puts a starting balance after the other rows of its date, as the web does, across a page boundary', async () => {
    await setPref('accounts-register-page-size', '5');
    // Eight rows on one date; the starting balances have the highest sort
    // order, which would put them first without the flag
    for (let i = 0; i < 8; i++) {
      await addTxn(`s${i}`, { date: '2016-06-01', sort_order: 100 - i });
    }
    await addTxn('start-a', {
      date: '2016-06-01',
      sort_order: 900,
      starting_balance_flag: true,
    });
    await addTxn('start-b', {
      date: '2016-06-01',
      sort_order: 800,
      starting_balance_flag: true,
    });
    await addTxn('older', { date: '2016-05-01' });
    const expected = await webOrder();
    expect(expected.slice(0, 5)).not.toContain('start-a');
    const first = await register();
    expect(first.nextCursor).not.toBeNull();
    expect(first.rows.map(r => r.id)).toEqual(expected.slice(0, 5));
    expect(await readAll()).toEqual(expected);
  });

  it('refuses a tombstoned account', async () => {
    await addAccount('gone', 'Gone');
    await addTxn('g1', { account: 'gone' });
    await db.update('accounts', { id: 'gone', tombstone: 1 });
    await expect(register({ account_id: 'gone' })).rejects.toThrow(/account/);
  });

  it('uses the default page size, a changed one, and falls back on bad values', async () => {
    await seedMany();
    expect((await register()).rows).toHaveLength(50);
    await setPref('accounts-register-page-size', '120');
    expect((await register()).rows).toHaveLength(120);
    for (const bad of ['500', '0', '1e2', 'abc']) {
      await setPref('accounts-register-page-size', bad);
      expect((await register()).rows).toHaveLength(50);
    }
  });

  it('neither repeats nor skips when a newer row arrives between pages', async () => {
    await seedMany();
    const first = await register();
    await addTxn('newer', { date: '2016-12-31', sort_order: 5000 });
    const second = await register({ cursor: first.nextCursor });
    const seen = new Set(first.rows.map(r => r.id));
    expect(second.rows.some(r => seen.has(r.id))).toBe(false);
    const rest = await readAll({});
    expect(rest).toContain('newer');
    expect(second.rows[0].id).toBe(
      (await readAll({})).filter(id => id !== 'newer')[50],
    );
  });

  it('stays consistent when rows are edited or deleted between pages', async () => {
    await seedMany();
    const first = await register();
    const before = await webOrder();
    const cutId = first.rows[first.rows.length - 1].id;
    // Edit a first-page row to a newer date, delete one on the second page and
    // move a later row ahead of the cursor
    await db.updateTransaction({ id: first.rows[3].id, date: '2017-01-05' });
    await db.deleteTransaction({ id: before[55] });
    await db.updateTransaction({ id: before[80], date: '2016-12-31' });
    const now = await webOrder();
    const rest = await readAll({}, first.nextCursor);
    expect(rest).toEqual(now.slice(now.indexOf(cutId) + 1));
    expect(rest).not.toContain(before[55]);
    expect(rest).not.toContain(before[80]);
  });

  it.each([
    ['not base64', '%%%'],
    ['not JSON', btoa('nope')],
    [
      'a string date',
      encode({
        date: '20161220',
        starting_balance_flag: -1,
        sort_order: 1,
        id: 'a',
      }),
    ],
    [
      'a fractional date',
      encode({ date: 1.5, starting_balance_flag: -1, sort_order: 1, id: 'a' }),
    ],
    [
      'a missing id',
      encode({ date: 20161220, starting_balance_flag: -1, sort_order: 1 }),
    ],
    [
      'an extra key',
      encode({
        date: 20161220,
        starting_balance_flag: -1,
        sort_order: 1,
        id: 'a',
        x: 1,
      }),
    ],
    [
      'a numeric id',
      encode({
        date: 20161220,
        starting_balance_flag: -1,
        sort_order: 1,
        id: 1,
      }),
    ],
    ['a missing flag', encode({ date: 20161220, sort_order: 1, id: 'a' })],
    [
      'a string flag',
      encode({
        date: 20161220,
        starting_balance_flag: '1',
        sort_order: 1,
        id: 'a',
      }),
    ],
    ['an array', encode([20161220, -1, 1, 'a'])],
  ])('refuses a forged cursor: %s', async (_, cursor) => {
    await seedMany();
    await expect(register({ cursor })).rejects.toThrow(/cursor/);
  });

  it('refuses a search over 100 characters, a bad scope and an unknown account', async () => {
    await expect(register({ search: 'x'.repeat(101) })).rejects.toThrow(
      /search/,
    );
    expect((await register({ search: 'x'.repeat(100) })).rows).toEqual([]);
    // The cap counts UTF-16 units (JS length), which Swift counts the same way
    await expect(register({ search: '😀'.repeat(51) })).rejects.toThrow(
      /search/,
    );
    expect((await register({ search: '😀'.repeat(50) })).rows).toEqual([]);
    await expect(register({ scope: 'bogus' as never })).rejects.toThrow(
      /scope/,
    );
    await expect(register({ account_id: 'nope' })).rejects.toThrow(/account/);
  });

  it('reads a closed account (read-only on the screen)', async () => {
    await addTxn('o1', { account: 'old', amount: 700 });
    expect((await register({ account_id: 'old' })).rows).toHaveLength(1);
  });

  describe('rows, scopes and search', () => {
    beforeEach(async () => {
      await addTxn('food', {
        date: '2016-12-28',
        amount: -4180,
        payee: 'grocer',
        category: 'groceries',
        notes: 'weekly shop',
        cleared: true,
      });
      await addTxn('plain', { date: '2016-12-27', amount: -500 });
      await addTxn('lock', {
        date: '2016-12-26',
        amount: 2500,
        cleared: true,
        reconciled: true,
        notes: '50%_off',
      });
      await addTxn('split', {
        date: '2016-12-25',
        amount: -3000,
        is_parent: true,
      });
      await addTxn('split-a', {
        date: '2016-12-25',
        amount: -1000,
        is_child: true,
        parent_id: 'split',
        notes: 'costco run',
        category: 'groceries',
      });
      await addTxn('split-b', {
        date: '2016-12-25',
        amount: -2000,
        is_child: true,
        parent_id: 'split',
      });
      // Checking to Savings, partner row reconciled
      await addTxn('out', {
        date: '2016-12-24',
        amount: -7000,
        payee: 'to-savings',
        transfer_id: 'in',
      });
      await addTxn('in', {
        account: 'savings',
        date: '2016-12-24',
        amount: 7000,
        payee: 'to-checking',
        transfer_id: 'out',
        cleared: true,
        reconciled: true,
      });
    });

    it('carries the header, names, splits, transfers and reconciled state, matching the fixture', async () => {
      await setPref('show-balances-checking', 'true');
      const page = await register();
      expect(page.rows.map(r => r.id)).toEqual([
        'food',
        'plain',
        'lock',
        'split',
        'out',
      ]);
      const byId = Object.fromEntries(page.rows.map(r => [r.id, r]));
      expect(byId.food).toMatchObject({
        payee: 'Grocer',
        category: 'Groceries',
        // sc-3611: the picker marks the current category by id
        categoryId: 'groceries',
        notes: 'weekly shop',
        cleared: true,
        reconciled: false,
        splitCount: 0,
        transferAccount: null,
        transferReconciled: null,
      });
      expect(byId.split).toMatchObject({ splitCount: 2, category: null });
      expect(byId.lock.reconciled).toBe(true);
      expect(byId.out).toMatchObject({
        transferAccount: { id: 'savings', name: 'Savings' },
        transferReconciled: true,
      });
      expect(page.header).toEqual({
        balance: await web({ account: 'checking' }),
        cleared: 4180 * -1 + 2500,
        uncleared: -500 - 3000 - 7000,
      });
      // sc-4973 (D7): upcoming rows are their own read
      expect(page).not.toHaveProperty('upcoming');
      await expect(JSON.stringify(page, null, 2) + '\n').toMatchFileSnapshot(
        './fixtures/account-register.json',
      );
    });

    it('sends the header on the first page only', async () => {
      await setPref('accounts-register-page-size', '2');
      const first = await register();
      expect(first.header).toBeDefined();
      const second = await register({ cursor: first.nextCursor });
      expect(second.header).toBeUndefined();
    });

    it('filters by scope', async () => {
      expect(
        (await register({ scope: 'uncleared' })).rows.map(r => r.id),
      ).toEqual(['plain', 'split', 'out']);
      // A categorized row, a split parent and a transfer between on-budget accounts are not uncategorized
      expect(
        (await register({ scope: 'uncategorized' })).rows.map(r => r.id),
      ).toEqual(['plain', 'lock']);
    });

    it('searches payee, category, notes and amount, a matching child returning its parent', async () => {
      const ids = async (search: string) =>
        (await register({ search })).rows.map(r => r.id);
      expect(await ids('grocer')).toEqual(['food', 'split']);
      expect(await ids('GROCERIES')).toEqual(['food', 'split']);
      expect(await ids('weekly')).toEqual(['food']);
      expect(await ids('costco')).toEqual(['split']);
      expect(await ids('41.80')).toEqual(['food']);
      expect(await ids('-41.80')).toEqual(['food']);
    });

    // sc-3611: the search footer's "N results" and total, over every page
    describe('result count and total', () => {
      it('counts and sums the whole filtered set, a split once at its parent amount', async () => {
        await setPref('accounts-register-page-size', '1');
        // 'grocer' matches food, and split through its child's category
        const first = await register({ search: 'grocer' });
        expect(first.rows).toHaveLength(1);
        expect(first.resultCount).toBe(2);
        expect(first.resultTotal).toBe(-4180 + -3000);
        // A matching child counts its parent once, not the child's amount
        await setPref('accounts-register-page-size', '50');
        await expect(
          JSON.stringify(await register({ search: 'grocer' }), null, 2) + '\n',
        ).toMatchFileSnapshot('./fixtures/account-register-search.json');
        const child = await register({ search: 'costco' });
        expect(child.resultCount).toBe(1);
        expect(child.resultTotal).toBe(-3000);
        const scope = await register({ scope: 'uncleared' });
        expect(scope.resultCount).toBe(3);
        expect(scope.resultTotal).toBe(-500 - 3000 - 7000);
      });

      it('is zero with no match', async () => {
        const none = await register({ search: 'nothing like it' });
        expect(none.resultCount).toBe(0);
        expect(none.resultTotal).toBe(0);
      });

      it('is left out unfiltered and after the first page', async () => {
        await setPref('accounts-register-page-size', '1');
        const all = await register();
        expect(all.resultCount).toBeUndefined();
        expect(all.resultTotal).toBeUndefined();
        const first = await register({ search: 'grocer' });
        const second = await register({
          search: 'grocer',
          cursor: first.nextCursor,
        });
        expect(second.resultCount).toBeUndefined();
        expect(second.resultTotal).toBeUndefined();
      });
    });

    it('matches % _ and \\ literally', async () => {
      const ids = async (search: string) =>
        (await register({ search })).rows.map(r => r.id);
      expect(await ids('50%_off')).toEqual(['lock']);
      expect(await ids('%')).toEqual(['lock']);
      expect(await ids('_')).toEqual(['lock']);
      expect(await ids('\\')).toEqual([]);
      expect(await ids("x' OR 1=1 --")).toEqual([]);
    });

    describe('running balance', () => {
      const balances = async (over: Partial<Args> = {}) =>
        (await register(over)).rows.map(r => r.runningBalance);

      it('is null until the account shows balances', async () => {
        expect((await balances()).every(b => b === null)).toBe(true);
      });

      it('is the balance after each row, across pages, when unfiltered', async () => {
        await setPref('show-balances-checking', 'true');
        await setPref('accounts-register-page-size', '2');
        const all = await readAllRows();
        const total = await web({ account: 'checking' });
        expect(all[0].runningBalance).toBe(total);
        let expected = total;
        for (const row of all) {
          expect(row.runningBalance).toBe(expected);
          expected -= row.amount;
        }
        expect(expected).toBe(0);
      });

      it('is null while filtered', async () => {
        await setPref('show-balances-checking', 'true');
        expect(
          (await balances({ scope: 'uncleared' })).every(b => b === null),
        ).toBe(true);
        expect((await balances({ search: 'o' })).every(b => b === null)).toBe(
          true,
        );
      });
    });

    async function readAllRows() {
      const rows = [];
      let cursor: string | null = null;
      do {
        const page = await register({ cursor });
        rows.push(...page.rows);
        cursor = page.nextCursor;
      } while (cursor);
      return rows;
    }
  });
});
