import os from 'node:os';

// Run: yarn workspace @actual-app/core run perf (excluded from `yarn test`).
// Fork-only (sc-4386). Times `native/accounts-list` on 50 accounts and
// `native/account-register` for a first page and a page 10,000 rows deep of a
// 20,000-row account, with and without search (ADR 11 gate: one round trip
// under 50 ms). The loot-core half only. Prints the median and p95 every run.
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { app as schedulesApp } from '#server/schedules/app';
import { loadRules, updateRule } from '#server/transactions/transaction-rules';
import { q } from '#shared/query';

import { app } from './app';

const ACCOUNTS = 50;
const ROWS = 20_000;
const DEEP_PAGES = 10_000 / 50;
const RUNS = 30;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

async function time(label: string, run: () => Promise<unknown>) {
  await run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = percentile(times, 0.5);
  // stderr, which the perf run prints (stdout is silenced)
  console.error(
    `${label}: median ${median.toFixed(1)} ms, p95 ${percentile(times, 0.95).toFixed(1)} ms`,
  );
  return median;
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  global.currentMonth = '2017-01';
});

afterEach(() => {
  vi.useRealTimers();
  global.currentMonth = null;
});

describe('native accounts reads', () => {
  it('load within the 50 ms gate', async () => {
    for (let a = 0; a < ACCOUNTS; a++) {
      await db.insertAccount({ id: `a${a}`, name: `Account ${a}` });
    }
    // a0 holds 20,000 rows. Written straight into the table: 20,000 synced
    // inserts overflow the CRDT clock's counter
    for (let i = 0; i < ROWS; i++) {
      db.runQuery(
        'INSERT INTO transactions (id, acct, date, sort_order, amount, notes, cleared, isParent, isChild, tombstone, reconciled) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)',
        [
          `t${i}`,
          'a0',
          20000000 + (i % 17) * 10000 + ((i % 12) + 1) * 100 + ((i % 27) + 1),
          i,
          -100 * (i + 1),
          i % 3 === 0 ? `note ${i}` : null,
          i % 2,
        ],
      );
    }
    for (let a = 1; a < ACCOUNTS; a++) {
      await db.insertTransaction({
        id: `o${a}`,
        account: `a${a}`,
        date: '2016-12-20',
        amount: 1000 * a,
      });
    }
    await db.update('preferences', { id: 'show-balances-a0', value: 'true' });

    const read = app.handlers['native/account-register'];
    const first = (search: string | null, cursor: string | null) =>
      read({ account_id: 'a0', scope: 'all', search, cursor });
    // The cursor 10,000 rows in, read by paging as the app does
    const deepCursor = async (search: string | null) => {
      let cursor: string | null = null;
      for (let i = 0; i < DEEP_PAGES; i++) {
        cursor = (await first(search, cursor)).nextCursor;
      }
      return cursor;
    };

    expect(
      await time('native/accounts-list', () =>
        app.handlers['native/accounts-list'](),
      ),
    ).toBeLessThan(50);
    expect(
      await time('native/account-register first page', () => first(null, null)),
    ).toBeLessThan(50);
    const deep = await deepCursor(null);
    expect(deep).not.toBeNull();
    expect(
      await time('native/account-register page 10,000 rows deep', () =>
        first(null, deep),
      ),
    ).toBeLessThan(50);
    expect(
      await time('native/account-register first page, search', () =>
        first('note 1', null),
      ),
    ).toBeLessThan(50);
    // sc-3611: the first page of a broad search and of a scope carries the
    // count and total over the whole filtered set
    expect(
      await time(
        'native/account-register first page, broad search with count and total',
        async () => {
          const page = await first('note', null);
          expect(page.resultCount).toBeGreaterThan(6000);
        },
      ),
    ).toBeLessThan(50);
    expect(
      await time(
        'native/account-register first page, uncleared with count and total',
        async () => {
          const page = await read({
            account_id: 'a0',
            scope: 'uncleared',
            search: null,
            cursor: null,
          });
          expect(page.resultCount).toBe(ROWS / 2);
        },
      ),
    ).toBeLessThan(50);
    const deepSearch = await deepCursor('note');
    expect(deepSearch).not.toBeNull();
    expect(
      await time('native/account-register page deep, search', () =>
        first('note', deepSearch),
      ),
    ).toBeLessThan(50);
  }, 600_000);

  // sc-4973 (native-register-upcoming-rows D6): with 200 schedules in the
  // window and a worst case of 50 daily schedules across the 92-day cap, the
  // register's first page within 50 ms, and the upcoming read within 100 ms
  // and 150 ms. Prints the load average: time on a quiet machine
  it('load with schedules within their gates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2017, 0, 1));
    await loadMappings();
    await loadRules();
    schedulesApp.startServices();
    await db.insertCategoryGroup({ id: 'bills', name: 'Bills' });
    await db.insertCategory({ id: 'bill', name: 'Bill', cat_group: 'bills' });
    for (let a = 0; a < 21; a++) {
      await db.insertAccount({ id: `a${a}`, name: `Account ${a}` });
      await db.insertPayee({
        id: `to-a${a}`,
        name: `Account ${a}`,
        transfer_acct: `a${a}`,
      });
    }
    for (let i = 0; i < ROWS; i++) {
      db.runQuery(
        'INSERT INTO transactions (id, acct, date, sort_order, amount, notes, cleared, isParent, isChild, tombstone, reconciled) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)',
        [
          `t${i}`,
          'a0',
          20000000 + (i % 17) * 10000 + ((i % 12) + 1) * 100 + ((i % 27) + 1),
          i,
          -100 * (i + 1),
          i % 3 === 0 ? `note ${i}` : null,
          i % 2,
        ],
      );
    }
    const day = (i: number) => `2017-01-0${(i % 7) + 1}`;
    const schedule = async (
      i: number,
      date: unknown,
      account: string,
      actions: Record<string, unknown>[],
      extra: Record<string, unknown> = {},
    ) => {
      const id = await schedulesApp.handlers['schedule/create']({
        schedule: { name: `S${i}`, ...extra },
        conditions: [
          { op: 'is', field: 'date', value: date },
          { op: 'is', field: 'amount', value: -(i + 1) * 100 },
          { op: 'is', field: 'account', value: account },
        ] as never,
      });
      const { data: rule } = (await aqlQuery(
        q('schedules').filter({ id }).calculate('rule'),
      )) as { data: string };
      await updateRule({
        id: rule,
        actions: [...actions, { op: 'link-schedule', value: id }],
      } as never);
    };
    const category = { op: 'set', field: 'category', value: 'bill' };
    const notes = (i: number) => ({
      op: 'set',
      field: 'notes',
      value: `scheduled ${i}`,
    });
    const split = (into: string) => [
      {
        op: 'set-split-amount',
        field: 'amount',
        value: -50,
        options: { splitIndex: 1, method: 'fixed-amount' },
      },
      { op: 'set', field: 'payee', value: into, options: { splitIndex: 1 } },
      {
        op: 'set-split-amount',
        field: 'amount',
        options: { splitIndex: 2, method: 'remainder' },
      },
    ];
    const daily = (start: string) => ({
      start,
      frequency: 'daily',
      patterns: [],
      skipWeekend: false,
      weekendSolveMode: 'after',
    });
    // 200 schedules: 20 splits (10 with a line into a0), 20 transfers into
    // a0, 5 daily and 155 plain ones on a0, all inside the default 7 days
    let i = 0;
    for (; i < 10; i++) await schedule(i, day(i), 'a0', split('to-a1'));
    for (; i < 20; i++) await schedule(i, day(i), 'a1', split('to-a0'));
    for (; i < 40; i++) {
      await schedule(i, day(i), `a${(i % 20) + 1}`, [
        { op: 'set', field: 'payee', value: 'to-a0' },
      ]);
    }
    for (; i < 45; i++) {
      await schedule(i, daily('2017-01-01'), 'a0', [category, notes(i)]);
    }
    for (; i < 200; i++) await schedule(i, day(i), 'a0', [category, notes(i)]);

    const register = app.handlers['native/account-register'];
    const upcoming = app.handlers['native/account-upcoming'];
    type Scope = 'all' | 'uncleared';
    const page = (scope: Scope, search: string | null) =>
      register({ account_id: 'a0', scope, search, cursor: null });
    const scheduled = (scope: Scope, search: string | null) =>
      upcoming({ account_id: 'a0', scope, search });
    const load = `load ${os.loadavg()[0].toFixed(1)} on ${os.cpus().length} cores`;
    console.error(`native accounts reads with schedules: ${load}`);
    // More previews than the row cap: rules run for the cap's worth
    expect((await scheduled('all', null)).upcomingAll).toBeGreaterThan(200);
    // Every case is timed and printed before the gates fail any of them
    const over: string[] = [];
    const gate = async (
      label: string,
      limit: number,
      run: () => Promise<unknown>,
    ) => {
      const median = await time(label, run);
      if (median >= limit) over.push(`${label}: ${median.toFixed(1)} ms`);
    };
    const cases = async (label: string, limit: number) => {
      for (const [name, scope, search] of [
        ['no filter', 'all', null],
        ['search', 'all', 'scheduled 1'],
        ['uncleared', 'uncleared', null],
      ] as const) {
        // D7: the register read does no schedule work
        await gate(`native/account-register ${label}, ${name}`, 50, () =>
          page(scope, search),
        );
        await gate(`native/account-upcoming ${label}, ${name}`, limit, () =>
          scheduled(scope, search),
        );
      }
    };
    await cases('with 200 schedules', 100);

    // Worst case: 50 daily schedules over the full 92-day cap, about 4,600
    // previews, cut to the row cap before rules run
    for (; i < 250; i++) {
      await schedule(i, daily('2017-01-01'), 'a0', [category, notes(i)], {
        custom_upcoming_length: '92-day',
      });
    }
    expect((await scheduled('all', null)).upcomingAll).toBeGreaterThan(4600);
    await cases('worst case, 50 daily over 92 days', 150);
    console.error(`native accounts reads with schedules: ${load}`);
    expect(over).toEqual([]);
  }, 600_000);
});
