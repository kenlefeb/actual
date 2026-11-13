// Fork-only (sc-3823). Times the `native/budget-month` handler on a 300-category
// month (plus one income category), the load behind the native Budget tab (ADR 11 gate: one round trip under
// 50 ms). This is the loot-core half only: no WKWebView hop, no Swift decode.
// Prints the median and p95 on every run.
import { createBudget } from '#server/budget/base';
import * as db from '#server/db';
import * as prefs from '#server/prefs';
import * as sheet from '#server/sheet';

import { app } from './app';

const GROUPS = 15;
const PER_GROUP = 20;
const RUNS = 50;

beforeEach(global.emptyDatabase());

beforeEach(async () => {
  global.currentMonth = '2026-03';
  await sheet.loadSpreadsheet(db);
  await prefs.loadPrefs();
});

afterEach(() => {
  global.currentMonth = null;
});

const percentile = (sorted: number[], p: number) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

describe('native/budget-month on 300 categories', () => {
  it('loads within the 50 ms gate and reports median and p95', async () => {
    await db.insertAccount({ id: 'checking', name: 'Checking' });
    await db.insertCategoryGroup({
      id: 'income',
      name: 'Income',
      is_income: 1,
    });
    await db.insertCategory({
      id: 'salary',
      name: 'Salary',
      cat_group: 'income',
      is_income: 1,
    });
    for (let g = 0; g < GROUPS; g++) {
      await db.insertCategoryGroup({ id: `g${g}`, name: `Group ${g}` });
      for (let c = 0; c < PER_GROUP; c++) {
        await db.insertCategory({
          id: `c${g}-${c}`,
          name: `Category ${g}-${c}`,
          cat_group: `g${g}`,
        });
      }
    }
    await createBudget(['2026-02', '2026-03']);
    for (let g = 0; g < GROUPS; g++) {
      for (let c = 0; c < PER_GROUP; c++) {
        const id = `c${g}-${c}`;
        sheet.get().set(`budget202603!budget-${id}`, 1000 * (c + 1));
        await db.insertTransaction({
          id: `t${id}`,
          date: '2026-03-02',
          account: 'checking',
          amount: -500 * (c + 1),
          category: id,
        });
      }
    }
    await sheet.waitOnSpreadsheet();

    const read = () =>
      app.handlers['native/budget-month']({ month: '2026-03' });
    for (let i = 0; i < 5; i++) await read();

    const times: number[] = [];
    let result = await read();
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      result = await read();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = percentile(times, 0.5);
    const p95 = percentile(times, 0.95);
    const categories = result.groups.reduce(
      (n, g) => n + g.categories.length,
      0,
    );
    // vitest.config.ts prints only stderr, so the numbers go there
    // oxlint-disable-next-line no-console
    console.error(
      `native/budget-month, ${categories} categories, ${JSON.stringify(result).length} bytes, ${RUNS} runs: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms (gate 50 ms)`,
    );

    expect(categories).toBe(GROUPS * PER_GROUP + 1);
    expect(median).toBeLessThan(50);
  });
});
