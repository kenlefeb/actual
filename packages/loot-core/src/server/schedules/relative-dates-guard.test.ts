// Guards the fork's relative date shape (RelativeDateConfig) against upstream merges.
import MockDate from 'mockdate';

import { aqlQuery } from '#server/aql';
import { runSchedule } from '#server/budget/schedule-template';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import {
  getFutureOccurrenceDates,
  getNormalizedSchedules,
} from '#server/forecast/forecast-schedules';
import { loadRules } from '#server/transactions/transaction-rules';
import { currencies } from '#shared/currencies';
import { q } from '#shared/query';
import { setScheduleDates } from '#shared/schedule-date-lookup';
import { computeSchedulePreviewTransactions } from '#shared/schedules';
import type {
  CategoryEntity,
  RecurConfig,
  RelativeDateConfig,
  ScheduleEntity,
} from '#types/models';

import {
  advanceSchedulesService,
  createSchedule,
  app as schedulesApp,
  setNextDate,
} from './app';

// No budget sheet is loaded here; last month's goal only matters for
// sub-monthly schedules
vi.mock('#server/budget/actions', async () => ({
  ...(await vi.importActual('#server/budget/actions')),
  getSheetValue: async () => 0,
}));

// Tests fix "today" at Sun 2017-01-01. Payday is the 10th: Tue Jan 10,
// Fri Feb 10, Fri Mar 10. Two days before lands on Sun Jan 8; two business
// days before skips the weekend to Fri Jan 6.
const paydayDate = {
  start: '2016-12-10',
  frequency: 'monthly' as const,
  patterns: [],
  skipWeekend: false,
  weekendSolveMode: 'after' as const,
  endMode: 'never' as const,
  endOccurrences: 1,
  endDate: '2017-12-10',
  interval: 1,
};

// Both units land on Thu Dec 8 for Sat Dec 10, 2016: the missed occurrence
const december = '2016-12-08';

const cases = [
  {
    unit: 'days' as const,
    dates: ['2017-01-08', '2017-02-08', '2017-03-08'],
  },
  {
    unit: 'business-days' as const,
    dates: ['2017-01-06', '2017-02-08', '2017-03-08'],
  },
];

function relativeTo(
  scheduleId: string,
  unit: RelativeDateConfig['relativeTo']['unit'],
): RelativeDateConfig {
  return {
    relativeTo: { scheduleId, offset: 2, unit, direction: 'before' },
  };
}

async function createRelative(
  unit: RelativeDateConfig['relativeTo']['unit'],
  {
    postsTransaction = false,
    sourceDate = paydayDate,
  }: { postsTransaction?: boolean; sourceDate?: RecurConfig } = {},
) {
  const accountId = await db.insertAccount({
    name: 'Checking',
    offbudget: 0,
    closed: 0,
  });
  const payday = await createSchedule({
    schedule: { name: 'Payday' },
    conditions: [{ op: 'isapprox', field: 'date', value: sourceDate }],
  });
  const config = relativeTo(payday, unit);
  const id = await createSchedule({
    schedule: { name: 'Deposit', posts_transaction: postsTransaction },
    conditions: [
      { op: 'is', field: 'account', value: accountId },
      { op: 'is', field: 'amount', value: -10000 },
      { op: 'isapprox', field: 'date', value: config },
    ],
  });
  return { id, config };
}

async function getSchedule(id: string): Promise<ScheduleEntity> {
  const { data } = await aqlQuery(q('schedules').filter({ id }).select('*'));
  return data[0];
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  MockDate.set(new Date(2017, 0, 1, 12));
  // Keeps the schedules view's _date, _amount and _account columns current
  schedulesApp.startServices();
});

afterEach(async () => {
  await schedulesApp.stopServices();
  setScheduleDates([]);
  MockDate.reset();
});

describe.each(cases)(
  'a schedule two $unit before payday',
  ({ unit, dates }) => {
    it('has the computed next date', async () => {
      const { id } = await createRelative(unit);
      expect((await getSchedule(id)).next_date).toBe(dates[0]);
    });

    it('lists the computed upcoming dates', async () => {
      const { config } = await createRelative(unit);
      expect(
        await schedulesApp.handlers['schedule/get-upcoming-dates']({
          config,
          count: 3,
        }),
      ).toEqual(dates);
    });

    it('previews transactions on the computed dates', async () => {
      const { id } = await createRelative(unit);
      const schedule = await getSchedule(id);
      const preview = computeSchedulePreviewTransactions(
        [schedule],
        new Map([[id, 'upcoming']]),
        '3-month',
      );
      expect(preview.map(t => [t.date, t.amount])).toEqual(
        [...dates].reverse().map(date => [date, -10000]),
      );
    });

    it('posts a missed occurrence on its computed date', async () => {
      // setNextDate reads the clock, so on Dec 1 it computes the December
      // occurrence. Set the clock first: sync timestamps must only move forward.
      MockDate.set(new Date(2016, 11, 1, 12));
      const { id } = await createRelative(unit, { postsTransaction: true });
      await setNextDate({ id });
      expect((await getSchedule(id)).next_date).toBe(december);
      MockDate.set(new Date(2017, 0, 1, 12));

      await advanceSchedulesService(true);

      const { data: transactions } = await aqlQuery(
        q('transactions').filter({ schedule: id }).select(['date', 'amount']),
      );
      expect(
        transactions.map((t: { date: string; amount: number }) => [
          t.date,
          t.amount,
        ]),
      ).toEqual([[december, -10000]]);
    });

    it('forecasts the computed dates', async () => {
      const { id } = await createRelative(unit);
      const schedule = (await getNormalizedSchedules()).find(s => s.id === id);
      expect(
        getFutureOccurrenceDates(schedule!, new Date(2017, 2, 31)),
      ).toEqual(dates);
    });

    it('budgets the schedule goal template in the month of its date', async () => {
      // One payday on Wed Mar 1; two days or business days before is Mon Feb 27
      const { id } = await createRelative(unit, {
        sourceDate: {
          ...paydayDate,
          start: '2017-03-01',
          endMode: 'after_n_occurrences',
        },
      });
      const category = { id: 'cat', name: 'Deposits' } as CategoryEntity;
      const template = {
        type: 'schedule',
        name: 'Deposit',
        scheduleId: id,
        priority: 0,
        directive: 'template',
      } as const;
      const budget = (month: string) =>
        runSchedule([template], month, 0, 0, 0, 0, [], category, currencies[0]);

      const february = await budget('2017-02-01');
      expect(february.errors).toEqual([]);
      expect(february.to_budget).toBe(10000);
      expect((await budget('2017-03-01')).to_budget).toBe(0);
    });
  },
);
