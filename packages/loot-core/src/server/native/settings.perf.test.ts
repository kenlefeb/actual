// Run: yarn workspace @actual-app/core run perf (excluded from `yarn test`).
// Fork-only (sc-4643, native-settings-screen D3). Times `native/settings` and
// a one-preference `native/settings-save` on a budget with 2,000 preference
// rows (import mappings and per-account flags) and every limit set. Gate: a
// median under 50 ms each. Prints the median and p95 every run.
import * as db from '#server/db';
import * as prefs from '#server/prefs';

import { app } from './app';
import { LIMITS } from './limits';

const RUNS = 30;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

async function time(label: string, run: (i: number) => Promise<unknown>) {
  await run(-1);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await run(i);
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
});

describe('native settings', () => {
  it('read and save within the 50 ms gate', async () => {
    // Written straight into the table: 2,000 synced writes are slow to seed
    for (let i = 0; i < 1000; i++) {
      db.runQuery('INSERT INTO preferences (id, value) VALUES (?, ?)', [
        `csv-mappings-account-${i}`,
        JSON.stringify({ date: 'Date', payee: 'Payee', amount: 'Amount' }),
      ]);
      db.runQuery('INSERT INTO preferences (id, value) VALUES (?, ?)', [
        `show-balances-account-${i}`,
        'true',
      ]);
    }
    for (const [id, { ceiling }] of Object.entries(LIMITS)) {
      await db.update('preferences', { id, value: String(ceiling) });
    }

    expect(
      await time('native/settings', () => app.handlers['native/settings']()),
    ).toBeLessThan(50);
    const formats = ['comma-dot', 'dot-comma'];
    expect(
      await time('native/settings-save, one preference', i =>
        app.handlers['native/settings-save']({
          changes: { numberFormat: formats[(i + 2) % 2] },
          undoToken: `T${i}`,
        }),
      ),
    ).toBeLessThan(50);
  });
});
