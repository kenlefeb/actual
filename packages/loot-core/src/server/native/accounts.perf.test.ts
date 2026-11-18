// Run: yarn workspace @actual-app/core run perf (excluded from `yarn test`).
// Fork-only (sc-4386). Times `native/accounts-list` on 50 accounts and
// `native/account-register` for a first page and a page 10,000 rows deep of a
// 20,000-row account, with and without search (ADR 11 gate: one round trip
// under 50 ms). The loot-core half only. Prints the median and p95 every run.
import * as db from '#server/db';
import * as prefs from '#server/prefs';

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
    const deepSearch = await deepCursor('note');
    expect(deepSearch).not.toBeNull();
    expect(
      await time('native/account-register page deep, search', () =>
        first('note', deepSearch),
      ),
    ).toBeLessThan(50);
  }, 600_000);
});
