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
  async function readAll(over: Partial<Args> = {}) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await register({ ...over, cursor });
      ids.push(...page.rows.map(r => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  }

  it('orders newest first as the web does and pages every row once', async () => {
    await seedMany();
    const { data } = (await aqlQuery(
      q('transactions')
        .filter({ account: 'checking' })
        .select('id')
        .orderBy([{ date: 'desc' }, { sort_order: 'desc' }, 'id']),
    )) as { data: { id: string }[] };
    const ids = await readAll();
    expect(ids).toHaveLength(ROWS);
    expect(ids).toEqual(data.map(r => r.id));
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

  it.each([
    ['not base64', '%%%'],
    ['not JSON', btoa('nope')],
    ['a string date', encode({ date: '20161220', sort_order: 1, id: 'a' })],
    ['a fractional date', encode({ date: 1.5, sort_order: 1, id: 'a' })],
    ['a missing id', encode({ date: 20161220, sort_order: 1 })],
    ['an extra key', encode({ date: 20161220, sort_order: 1, id: 'a', x: 1 })],
    ['a numeric id', encode({ date: 20161220, sort_order: 1, id: 1 })],
    ['an array', encode([20161220, 1, 'a'])],
  ])('refuses a forged cursor: %s', async (_, cursor) => {
    await seedMany();
    await expect(register({ cursor })).rejects.toThrow(/cursor/);
  });

  it('refuses a search over 100 characters, a bad scope and an unknown account', async () => {
    await expect(register({ search: 'x'.repeat(101) })).rejects.toThrow(
      /search/,
    );
    expect((await register({ search: 'x'.repeat(100) })).rows).toEqual([]);
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
      expect(page.upcoming).toEqual([]);
      await expect(JSON.stringify(page, null, 2) + '\n').toMatchFileSnapshot(
        './fixtures/account-register.json',
      );
    });

    it('sends the header and upcoming on the first page only', async () => {
      await setPref('accounts-register-page-size', '2');
      const first = await register();
      expect(first.header).toBeDefined();
      const second = await register({ cursor: first.nextCursor });
      expect(second.header).toBeUndefined();
      expect(second.upcoming).toBeUndefined();
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

  it('lists the schedules due in the upcoming window on the first page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2017, 0, 1));
    await setPref('upcomingScheduledTransactionLength', '30');
    await schedulesApp.handlers['schedule/create']({
      schedule: { name: 'Rent' },
      conditions: [
        { op: 'is', field: 'date', value: '2017-01-10' },
        { op: 'is', field: 'amount', value: -150000 },
        { op: 'is', field: 'account', value: 'checking' },
      ],
    });
    const page = await register();
    expect(page.upcoming).toHaveLength(1);
    expect(page.upcoming?.[0]).toMatchObject({
      date: '2017-01-10',
      amount: -150000,
    });
    expect((await register({ account_id: 'savings' })).upcoming).toEqual([]);
  });
});
