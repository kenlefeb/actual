// Run: yarn workspace @actual-app/core run perf (excluded from `yarn test`).
// Fork-only (sc-4801). Times `native/reconcile-month` on 20 accounts and
// `native/reconcile-rows` (all) on an account with 2,000 rows, the loads behind
// the native Reconcile flow (ADR 11 gate: one round trip under 50 ms). The
// loot-core half only. Prints the median and p95 on every run.
import * as db from '#server/db';
import * as prefs from '#server/prefs';

import { app } from './app';

const ACCOUNTS = 20;
const ROWS = 2000;
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
  console.log(
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

describe('native reconcile reads', () => {
  it('load within the 50 ms gate', async () => {
    for (let a = 0; a < ACCOUNTS; a++) {
      await db.insertAccount({ id: `a${a}`, name: `Account ${a}` });
    }
    for (let i = 0; i < ROWS; i++) {
      await db.insertTransaction({
        id: `t${i}`,
        account: 'a0',
        date: `2016-${String((i % 12) + 1).padStart(2, '0')}-15`,
        amount: -100 * (i + 1),
        cleared: i % 2 === 0,
        reconciled: i % 4 === 0,
      });
    }

    expect(
      await time('native/reconcile-month', () =>
        app.handlers['native/reconcile-month'](),
      ),
    ).toBeLessThan(50);
    expect(
      await time('native/reconcile-rows', () =>
        app.handlers['native/reconcile-rows']({
          account_id: 'a0',
          scope: 'all',
        }),
      ),
    ).toBeLessThan(50);
    // sc-4825: step 3's matches and search, and step 4's preview
    await db.update('preferences', {
      id: 'statement-balance-a0',
      value: JSON.stringify({
        id: 'r',
        amount: 123457,
        source: 'entered',
        as_of: null,
        entered_at: Date.now(),
        entered_by: 'perf',
        consumed_at: null,
      }),
    });
    expect(
      await time('native/reconcile-matches', () =>
        app.handlers['native/reconcile-matches']({ account_id: 'a0' }),
      ),
    ).toBeLessThan(50);
    expect(
      await time('native/reconcile-rows search', () =>
        app.handlers['native/reconcile-rows']({
          account_id: 'a0',
          scope: 'all',
          search: '41.80',
        }),
      ),
    ).toBeLessThan(50);
    expect(
      await time('native/reconcile-lock-preview', () =>
        app.handlers['native/reconcile-lock-preview']({ account_id: 'a0' }),
      ),
    ).toBeLessThan(50);
  });
});
