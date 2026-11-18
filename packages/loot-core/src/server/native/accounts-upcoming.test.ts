// Fork-only (sc-4973, openspec/changes/native-register-upcoming-rows). The
// contract for the upcoming rows of `native/account-register`: rows as they
// will post, filtered by the posted rows' own predicate. The Swift tests decode
// fixtures/account-register-upcoming.json. Regenerate with `vitest -u`.
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { app as rulesApp } from '#server/rules/app';
import { app as schedulesApp } from '#server/schedules/app';
import { loadRules, updateRule } from '#server/transactions/transaction-rules';
import { q } from '#shared/query';
import {
  comparePreviewTransactions,
  inverseBasedOnAccount,
  isScheduleRelevantToAccount,
} from '#shared/schedule-preview';
import {
  computeSchedulePreviewTransactions,
  getStatus,
} from '#shared/schedules';
import type { ScheduleStatuses } from '#shared/schedules';
import { ungroupTransactions } from '#shared/transactions';
import type { AccountEntity, ScheduleEntity } from '#types/models';

import { app } from './app';

const h = app.handlers;
type Args = Parameters<(typeof h)['native/account-register']>[0];
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

type Action = Record<string, unknown>;
const daily = (start: string) => ({
  start,
  frequency: 'daily',
  patterns: [],
  skipWeekend: false,
  weekendSolveMode: 'after',
});

async function addAccount(id: string, name: string) {
  await db.insertAccount({ id, name });
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

async function addSchedule(
  name: string,
  {
    date,
    amount,
    account = 'checking',
    payee,
    actions = [],
    schedule = {},
  }: {
    date: unknown;
    amount: number;
    account?: string;
    payee?: string;
    actions?: Action[];
    schedule?: Record<string, unknown>;
  },
) {
  const id = await schedulesApp.handlers['schedule/create']({
    schedule: { name, ...schedule },
    conditions: [
      { op: 'is', field: 'date', value: date },
      { op: 'is', field: 'amount', value: amount },
      { op: 'is', field: 'account', value: account },
      ...(payee ? [{ op: 'is', field: 'payee', value: payee }] : []),
    ] as never,
  });
  if (actions.length > 0) {
    const { data: rule } = (await aqlQuery(
      q('schedules').filter({ id }).calculate('rule'),
    )) as { data: string };
    await updateRule({
      id: rule,
      actions: [...actions, { op: 'link-schedule', value: id }],
    } as never);
  }
  return id;
}

// A split schedule on Checking: 200.00 to Savings, the rest groceries
const addSplit = () =>
  addSchedule('Split', {
    date: '2017-01-05',
    amount: -50000,
    payee: 'grocer',
    actions: [
      {
        op: 'set-split-amount',
        field: 'amount',
        value: -20000,
        options: { splitIndex: 1, method: 'fixed-amount' },
      },
      {
        op: 'set',
        field: 'payee',
        value: 'to-savings',
        options: { splitIndex: 1 },
      },
      {
        op: 'set-split-amount',
        field: 'amount',
        options: { splitIndex: 2, method: 'remainder' },
      },
      {
        op: 'set',
        field: 'category',
        value: 'groceries',
        options: { splitIndex: 2 },
      },
    ],
  });

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  global.currentMonth = '2017-01';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2017, 0, 1));
  await addAccount('checking', 'Checking');
  await addAccount('savings', 'Savings');
  await addAccount('card', 'Card');
  await db.insertPayee({ id: 'grocer', name: 'Grocer' });
  await db.insertPayee({ id: 'power', name: 'Power Co' });
  await db.insertCategoryGroup({ id: 'bills', name: 'Bills' });
  await db.insertCategory({
    id: 'groceries',
    name: 'Groceries',
    cat_group: 'bills',
  });
  await db.insertCategory({
    id: 'utilities',
    name: 'Utilities',
    cat_group: 'bills',
  });
});

afterEach(() => {
  vi.useRealTimers();
  global.currentMonth = null;
});

describe('native/account-register upcoming rows', () => {
  it('runs the schedule rules and names the fields they set', async () => {
    const id = await addSchedule('Power', {
      date: '2017-01-03',
      amount: -9000,
      actions: [
        { op: 'set', field: 'payee', value: 'power' },
        { op: 'set', field: 'category', value: 'utilities' },
      ],
    });
    await addSchedule('Plain', {
      date: '2017-01-04',
      amount: -100,
      payee: 'grocer',
    });
    expect((await register()).upcoming).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^preview\/.+\/2017-01-04$/),
        payee: 'Grocer',
        ruleFields: [],
      }),
      {
        id: `preview/${id}/2017-01-03`,
        scheduleId: id,
        date: '2017-01-03',
        payee: 'Power Co',
        category: 'Utilities',
        categoryId: 'utilities',
        notes: null,
        amount: -9000,
        cleared: false,
        splitCount: 0,
        transferAccount: null,
        status: 'upcoming',
        ruleFields: ['payee', 'category'],
      },
    ]);
  });

  it('shows a split on its own account, and only its line into another account, inverted', async () => {
    const id = await addSplit();
    expect((await register()).upcoming).toEqual([
      expect.objectContaining({
        id: `preview/${id}/2017-01-05`,
        amount: -50000,
        splitCount: 2,
        // The rules clear a split parent's payee when its lines differ
        payee: null,
        ruleFields: ['payee', 'splits'],
      }),
    ]);
    expect((await register({ account_id: 'savings' })).upcoming).toEqual([
      expect.objectContaining({
        id: `preview/${id}/2017-01-05/1`,
        scheduleId: id,
        amount: 20000,
        payee: 'Checking',
        category: null,
        splitCount: 0,
        transferAccount: { id: 'checking', name: 'Checking' },
        ruleFields: ['payee', 'amount'],
      }),
    ]);
    expect((await register({ account_id: 'card' })).upcoming).toEqual([]);
  });

  it('inverts a plain transfer into the account, naming the other account', async () => {
    const id = await addSchedule('Save', {
      date: '2017-01-06',
      amount: -7000,
      payee: 'to-savings',
    });
    expect((await register({ account_id: 'savings' })).upcoming).toEqual([
      expect.objectContaining({
        id: `preview/${id}/2017-01-06`,
        amount: 7000,
        payee: 'Checking',
        transferAccount: { id: 'checking', name: 'Checking' },
      }),
    ]);
    expect((await register()).upcoming).toEqual([
      expect.objectContaining({
        amount: -7000,
        payee: 'Savings',
        transferAccount: { id: 'savings', name: 'Savings' },
      }),
    ]);
  });

  it('includes a split line whose payee a template formula sets to this account', async () => {
    const id = await addSchedule('Formula', {
      date: '2017-01-07',
      amount: -3000,
      payee: 'grocer',
      actions: [
        {
          op: 'set-split-amount',
          field: 'amount',
          options: { splitIndex: 1, method: 'remainder' },
        },
        {
          op: 'set',
          field: 'payee',
          // A formula on the payee id is a no-op in the rules; a template is
          // how a split line's payee is computed
          options: { splitIndex: 1, template: '{{#if true}}to-card{{/if}}' },
        },
      ],
    });
    expect((await register({ account_id: 'card' })).upcoming).toEqual([
      expect.objectContaining({
        id: `preview/${id}/2017-01-07/1`,
        amount: 3000,
        transferAccount: { id: 'checking', name: 'Checking' },
      }),
    ]);
  });

  it('gives each row its status: due, upcoming or missed', async () => {
    await addSchedule('Due', { date: '2017-01-01', amount: -1 });
    await addSchedule('Soon', { date: '2017-01-02', amount: -2 });
    await addSchedule('Missed', { date: '2016-12-30', amount: -3 });
    const status = Object.fromEntries(
      ((await register()).upcoming ?? []).map(r => [r.amount, r.status]),
    );
    expect(status).toEqual({ '-1': 'due', '-2': 'upcoming', '-3': 'missed' });
  });

  it('keeps ids stable between reads, in the documented format (fixture)', async () => {
    await addSplit();
    await addSchedule('Save', {
      date: '2017-01-06',
      amount: -7000,
      payee: 'to-savings',
    });
    const read = async () => ({
      checking: await register(),
      savings: await register({ account_id: 'savings' }),
    });
    const first = await read();
    expect(await read()).toEqual(first);
    for (const row of [
      ...(first.checking.upcoming ?? []),
      ...(first.savings.upcoming ?? []),
    ]) {
      expect(row.id).toMatch(/^preview\/[^/]+\/\d{4}-\d{2}-\d{2}(\/\d+)?$/);
      expect(row.id.startsWith(`preview/${row.scheduleId}/`)).toBe(true);
    }
    // Schedule ids are random: the fixture names them by schedule
    const { data: schedules } = (await aqlQuery(
      q('schedules').select(['id', 'name']),
    )) as { data: { id: string; name: string }[] };
    let named = JSON.stringify(first, null, 2);
    for (const s of schedules) {
      named = named.replaceAll(s.id, `schedule-${s.name.toLowerCase()}`);
    }
    await expect(named + '\n').toMatchFileSnapshot(
      './fixtures/account-register-upcoming.json',
    );
  });

  it('equals the web preview for the same budget, unfiltered and within the cap', async () => {
    await addSplit();
    await addSchedule('Save', {
      date: '2017-01-06',
      amount: -7000,
      payee: 'to-savings',
    });
    await addSchedule('Power', {
      date: daily('2017-01-02'),
      amount: -9000,
      actions: [
        { op: 'set', field: 'payee', value: 'power' },
        { op: 'set', field: 'category', value: 'utilities' },
        { op: 'set', field: 'notes', value: 'meter' },
      ],
    });
    await setPref('upcomingScheduledTransactionLength', '14');
    for (const account of ['checking', 'savings']) {
      const web = await webPreview(account);
      expect(web.length).toBeGreaterThan(0);
      expect((await register({ account_id: account })).upcoming).toEqual(
        web.map(row => expect.objectContaining(row)),
      );
    }
  });

  it('is on the first page only and leaves posted pages and cursors unchanged', async () => {
    for (let i = 0; i < 5; i++) {
      await addTxn(`p${i}`, { date: `2016-12-1${i}` });
    }
    await setPref('accounts-register-page-size', '2');
    const later = async () => {
      const out = [];
      let cursor = (await register()).nextCursor;
      while (cursor) {
        const page = await register({ cursor });
        out.push(page);
        cursor = page.nextCursor;
      }
      return out;
    };
    const before = await later();
    const firstBefore = await register();
    await addSchedule('Soon', { date: '2017-01-02', amount: -2 });
    const first = await register();
    expect(first.upcoming).toHaveLength(1);
    expect(first.rows).toEqual(firstBefore.rows);
    expect(first.nextCursor).toBe(firstBefore.nextCursor);
    const after = await later();
    expect(after).toEqual(before);
    for (const page of after) {
      expect(page).not.toHaveProperty('upcoming');
      expect(page).not.toHaveProperty('upcomingCount');
      expect(page).not.toHaveProperty('upcomingTotal');
      expect(page).not.toHaveProperty('upcomingCapDays');
    }
  });

  describe('scope and search', () => {
    beforeEach(async () => {
      await addTxn('cleared-rent', {
        date: '2016-12-20',
        amount: -150000,
        notes: 'rent',
        cleared: true,
      });
      await addSchedule('Netflix', {
        date: '2017-01-03',
        amount: -1599,
        actions: [
          { op: 'set', field: 'notes', value: 'netflix' },
          { op: 'set', field: 'category', value: 'utilities' },
        ],
      });
      await addSchedule('Rent', {
        date: '2017-01-04',
        amount: -150000,
        actions: [{ op: 'set', field: 'notes', value: 'rent' }],
      });
    });
    const amounts = async (over: Partial<Args>) =>
      ((await register(over)).upcoming ?? []).map(r => r.amount);

    it('shows the upcoming rows the posted rows filter would match', async () => {
      const uncleared = await register({ scope: 'uncleared' });
      expect(uncleared.upcoming?.map(r => r.amount)).toEqual([-150000, -1599]);
      expect(uncleared.rows.map(r => r.id)).not.toContain('cleared-rent');
      expect(await amounts({ search: 'netflix' })).toEqual([-1599]);
      expect(await amounts({ search: 'rent' })).toEqual([-150000]);
      expect(await amounts({ search: 'utilities' })).toEqual([-1599]);
      expect(await amounts({ search: '15.99' })).toEqual([-1599]);
      expect(await amounts({ scope: 'uncategorized' })).toEqual([-150000]);
      expect(await amounts({ scope: 'uncleared', search: 'rent' })).toEqual([
        -150000,
      ]);
    });

    it('returns a split when one of its lines matches', async () => {
      await addSplit();
      expect(await amounts({ search: 'groceries' })).toEqual([-50000]);
      // A split parent is never uncategorized, as for posted rows
      expect(await amounts({ scope: 'uncategorized' })).toEqual([-150000]);
    });

    it('counts and sums upcoming rows apart from the posted results', async () => {
      await addTxn('x-a', { date: '2016-12-01', amount: -1000, notes: 'xyz' });
      await addTxn('x-b', { date: '2016-12-02', amount: -500, notes: 'xyz' });
      await addSchedule('X', {
        date: '2017-01-05',
        amount: -2000,
        actions: [{ op: 'set', field: 'notes', value: 'xyz' }],
      });
      const page = await register({ search: 'xyz' });
      expect(page).toMatchObject({
        resultCount: 2,
        resultTotal: -1500,
        upcomingCount: 1,
        upcomingTotal: -2000,
      });
      expect(await register({ search: 'nothing like it' })).toMatchObject({
        upcoming: [],
        upcomingCount: 0,
        upcomingTotal: 0,
      });
    });
  });

  it('counts an inverted line once, and is empty with nothing upcoming', async () => {
    expect(await register()).toMatchObject({
      upcoming: [],
      upcomingCount: 0,
      upcomingTotal: 0,
    });
    await addSplit();
    expect(await register({ account_id: 'savings' })).toMatchObject({
      upcomingCount: 1,
      upcomingTotal: 20000,
    });
    expect(await register()).toMatchObject({
      upcomingCount: 1,
      upcomingTotal: -50000,
    });
  });

  it('filters more rows than SQLite binds as variables, as one JSON parameter', async () => {
    // 40 daily schedules over 366 days: about 14,600 rows, past both 999 and
    // 32,766 variables' worth at 12 a row
    await setPref('accounts-register-upcoming-max-days', '366');
    await setPref('upcomingScheduledTransactionLength', '400-day');
    for (let i = 0; i < 40; i++) {
      await addSchedule(`Daily ${i}`, {
        date: daily('2017-01-01'),
        amount: -(i + 1),
        actions: [{ op: 'set', field: 'notes', value: `daily ${i}` }],
      });
    }
    expect((await register()).upcomingCount).toBeGreaterThan(14_000);
    const found = await register({ scope: 'uncleared', search: 'daily 7' });
    // Every day from today through the cap
    expect(found.upcomingCount).toBe(367);
    expect(found.upcoming).toHaveLength(367);
    expect(new Set(found.upcoming?.map(r => r.amount))).toEqual(new Set([-8]));
  }, 300_000);

  describe('horizon cap', () => {
    it('cuts a longer window at the cap and says so', async () => {
      await addSchedule('Long', {
        date: daily('2017-01-01'),
        amount: -1,
        schedule: { custom_upcoming_length: '6-month' },
      });
      const page = await register();
      expect(page.upcomingCapDays).toBe(92);
      const dates = page.upcoming?.map(r => r.date);
      expect(dates).toContain('2017-04-03');
      expect(dates).not.toContain('2017-04-04');
      await setPref('accounts-register-upcoming-max-days', '120');
      expect((await register()).upcomingCapDays).toBe(120);
    });

    it('says nothing when no row was cut', async () => {
      await addSchedule('Soon', { date: daily('2017-01-01'), amount: -1 });
      expect(await register()).not.toHaveProperty('upcomingCapDays');
    });

    it('falls back to 92 days on a bad value', async () => {
      await addSchedule('Long', {
        date: daily('2017-01-01'),
        amount: -1,
        schedule: { custom_upcoming_length: '1-year' },
      });
      for (const value of ['0', '400', 'abc']) {
        await setPref('accounts-register-upcoming-max-days', value);
        expect((await register()).upcomingCapDays).toBe(92);
      }
    });
  });
});

// The web hook's steps (usePreviewTransactions, useAccountPreviewTransactions)
// with the web-only steps left out (the status shown as the category, the
// `preview/<uuid>` child ids), mapped to the compared fields
async function webPreview(account: string) {
  const { data: schedules } = (await aqlQuery(q('schedules').select('*'))) as {
    data: ScheduleEntity[];
  };
  const length =
    (
      await db.first<{ value: string }>(
        "SELECT value FROM preferences WHERE id = 'upcomingScheduledTransactionLength'",
      )
    )?.value ?? '7';
  const statuses = new Map(
    schedules.map(s => [
      s.id,
      getStatus(
        s.next_date,
        s.completed,
        false,
        s.custom_upcoming_length ?? length,
      ),
    ]),
  ) as ScheduleStatuses;
  const accounts = await db.getAccounts();
  const payees = await db.all<{
    id: string;
    name: string;
    transfer_acct: string | null;
  }>('SELECT id, name, transfer_acct FROM payees WHERE tombstone = 0');
  const categories = await db.all<{ id: string; name: string }>(
    'SELECT id, name FROM categories',
  );
  const getTransferAccountByPayee = (id?: string | null) =>
    (accounts.find(
      a => a.id === payees.find(p => p.id === id)?.transfer_acct,
    ) as unknown as AccountEntity) ?? null;
  const getPayeeByTransferAccount = (id?: string | null) =>
    payees.find(p => p.transfer_acct === id) ?? null;
  const previews = computeSchedulePreviewTransactions(
    schedules,
    statuses,
    length,
    schedule =>
      isScheduleRelevantToAccount({
        accountId: account,
        schedule,
        getTransferAccountByPayee,
      }),
  );
  const ran = await Promise.all(
    previews.map(transaction =>
      rulesApp.handlers['rules-run']({ transaction }),
    ),
  );
  const withDefaults = ran.map(t => ({
    ...t,
    sort_order: schedules.find(s => s.id === t.schedule)?.sort_order,
    subtransactions: t.subtransactions?.map(st => ({
      ...st,
      schedule: t.schedule,
    })),
  }));
  withDefaults.sort(comparePreviewTransactions);
  const ungrouped = ungroupTransactions(withDefaults);
  const { transactions } = inverseBasedOnAccount({
    accountId: account,
    transactions: ungrouped,
    runningBalances: new Map(),
    startingBalance: 0,
    getPayeeByTransferAccount,
    getTransferAccountByPayee,
  });
  return transactions
    .filter(t => !t.parent_id)
    .map(t => {
      const isLine = !previews.some(p => p.id === t.id);
      const transferId = payees.find(p => p.id === t.payee)?.transfer_acct;
      return {
        id: isLine
          ? expect.stringMatching(
              new RegExp(`^preview/${t.schedule}/${t.date}/\\d+$`),
            )
          : t.id,
        date: t.date,
        payee: payees.find(p => p.id === t.payee)?.name ?? null,
        category: (t as { inversed?: boolean }).inversed
          ? null
          : (categories.find(c => c.id === t.category)?.name ?? null),
        notes: t.notes || null,
        amount: t.amount,
        splitCount: ungrouped.filter(c => c.parent_id === t.id).length,
        transferAccount: transferId
          ? {
              id: transferId,
              name: accounts.find(a => a.id === transferId)?.name,
            }
          : null,
      };
    });
}
