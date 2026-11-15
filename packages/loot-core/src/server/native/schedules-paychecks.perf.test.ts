// Fork-only (sc-4341). Times `native/schedules-paychecks` on the Architect's
// seed: 20 paychecks with 4 deposits each, 200 other schedules and a year of
// pay transactions (the native-bridge latency gate: under 50 ms, median and
// p95). The loot-core half only: no WKWebView hop, no Swift decode.
import { app as businessCalendarsApp } from '#server/business-calendars/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app as paychecksApp } from '#server/paychecks/app';
import * as prefs from '#server/prefs';
import { app as schedulesApp } from '#server/schedules/app';
import { loadRules } from '#server/transactions/transaction-rules';
import { businessCalendarPresets } from '#shared/business-calendar-presets';

import { app } from './app';

const PAYCHECKS = 20;
const DEPOSITS = 4;
const SCHEDULES = 200;
const RUNS = 50;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  // No fake clock: vitest's fake Date is many times slower to construct, and
  // the date math builds thousands, so it would time the fake, not loot-core
  await db.insert('preferences', {
    id: 'flags.businessCalendars',
    value: 'true',
  });
});

describe('native/schedules-paychecks on the Architect seed', () => {
  it('loads within the 50 ms gate and reports median and p95', async () => {
    const calendar = await businessCalendarsApp.handlers[
      'business-calendar-create'
    ]({ name: 'Federal', ...businessCalendarPresets[0].calendar });
    await db.insertCategoryGroup({ id: 'ig', name: 'Income', is_income: 1 });
    await db.insertCategory({
      id: 'income',
      name: 'Income',
      cat_group: 'ig',
      is_income: 1,
    });
    for (let a = 0; a < DEPOSITS; a++) {
      await db.insertAccount({ id: `deposit-${a}`, name: `Deposit ${a}` });
      await db.insertPayee({
        id: `transfer-deposit-${a}`,
        name: '',
        transfer_acct: `deposit-${a}`,
      });
      await paychecksApp.handlers['account-set-business-days']({
        id: `deposit-${a}`,
        businessCalendarId: calendar,
        depositDaysEarly: a,
      });
    }

    for (let p = 0; p < PAYCHECKS; p++) {
      const clearing = `clearing-${p}`;
      await db.insertAccount({ id: clearing, name: `Employer ${p} Paycheck` });
      await db.insertPayee({
        id: `transfer-${clearing}`,
        name: '',
        transfer_acct: clearing,
      });
      await db.insertPayee({ id: `employer-${p}`, name: `Employer ${p}` });
      const id = await paychecksApp.handlers['paycheck-create']({
        name: `Employer ${p}`,
        definition: {
          payee: `employer-${p}`,
          clearingAccount: clearing,
          date: {
            start: '2025-11-01',
            frequency: 'monthly',
            patterns: [
              { type: 'day', value: 1 + (p % 14) },
              { type: 'day', value: 15 + (p % 13) },
            ],
          },
          weekendSolveMode: 'before',
          grossAmount: 400000,
          incomeCategory: 'income',
          deductions: [],
          deposits: Array.from({ length: DEPOSITS }, (_, a) =>
            a === DEPOSITS - 1
              ? {
                  id: `d${a}`,
                  account: `deposit-${a}`,
                  kind: 'remainder' as const,
                  value: 0,
                }
              : {
                  id: `d${a}`,
                  account: `deposit-${a}`,
                  kind: 'percent' as const,
                  value: 20,
                },
          ),
        },
      });
      const pay = (await paychecksApp.handlers['paychecks-get']()).find(
        c => c.id === id,
      )?.definition.paySchedule;
      // A year of twice-monthly pay, each a split of gross pay
      for (let m = 0; m < 12; m++) {
        for (const day of [1 + (p % 14), 15 + (p % 13)]) {
          const month = new Date(2025, 10 + m, day);
          const date = month.toISOString().slice(0, 10);
          const parent = await db.insertTransaction({
            account: clearing,
            amount: 400000,
            date,
            schedule: pay,
            is_parent: true,
          });
          await db.insertTransaction({
            account: clearing,
            amount: 400000,
            date,
            is_child: true,
            parent_id: parent,
          });
        }
      }
    }

    for (let s = 0; s < SCHEDULES; s++) {
      await schedulesApp.handlers['schedule/create']({
        schedule: { name: `Bill ${s}` },
        conditions: [
          {
            op: 'isapprox',
            field: 'date',
            value: {
              start: '2026-01-01',
              frequency: 'monthly',
              patterns: [{ type: 'day', value: 1 + (s % 28) }],
            },
          },
          { op: 'is', field: 'amount', value: -1000 * (s + 1) },
          { op: 'is', field: 'account', value: 'deposit-0' },
        ],
      });
    }

    const read = () => app.handlers['native/schedules-paychecks']();
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
    // vitest.config.ts prints only stderr, so the numbers go there
    // oxlint-disable-next-line no-console
    console.error(
      `native/schedules-paychecks, ${result.paychecks.length} paychecks, ${result.schedules.length} schedules, ${JSON.stringify(result).length} bytes, ${RUNS} runs: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms (gate 50 ms)`,
    );

    expect(result.paychecks).toHaveLength(PAYCHECKS);
    expect(result.paychecks[0].next?.deposits).toHaveLength(DEPOSITS);
    expect(result.schedules).toHaveLength(SCHEDULES);
    expect(median).toBeLessThan(50);
    expect(p95).toBeLessThan(50);
  }, 120_000);
});
