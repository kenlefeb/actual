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
  loadScheduleDateLookup,
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
  // As at budget load: keeps the schedule-date lookup in step with every write
  await loadScheduleDateLookup();
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

    it('posts a missed occurrence on its computed date and moves on', async () => {
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
      expect((await getSchedule(id)).next_date).toBe(dates[0]);
    });

    it('moves on once a past occurrence is paid', async () => {
      MockDate.set(new Date(2016, 11, 1, 12));
      const { id } = await createRelative(unit);
      await setNextDate({ id });
      const { _account, next_date } = await getSchedule(id);
      expect(next_date).toBe(december);
      await db.insertTransaction({
        account: _account,
        amount: -10000,
        date: december,
        schedule: id,
      });
      MockDate.set(new Date(2017, 0, 1, 12));

      await advanceSchedulesService(true);

      expect((await getSchedule(id)).next_date).toBe(dates[0]);
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

it('budgets every occurrence of a weekly source in a goal template', async () => {
  // Fridays; one day after lands on the four Saturdays of February 2017
  const weekly = {
    ...paydayDate,
    start: '2016-12-02',
    frequency: 'weekly' as const,
  };
  const accountId = await db.insertAccount({
    name: 'Checking',
    offbudget: 0,
    closed: 0,
  });
  const source = await createSchedule({
    schedule: { name: 'Weekly' },
    conditions: [{ op: 'isapprox', field: 'date', value: weekly }],
  });
  const id = await createSchedule({
    schedule: { name: 'After weekly' },
    conditions: [
      { op: 'is', field: 'account', value: accountId },
      { op: 'is', field: 'amount', value: -10000 },
      {
        op: 'isapprox',
        field: 'date',
        value: {
          relativeTo: {
            scheduleId: source,
            offset: 1,
            unit: 'days',
            direction: 'after',
          },
        },
      },
    ],
  });

  const february = await runSchedule(
    [
      {
        type: 'schedule',
        name: 'After weekly',
        scheduleId: id,
        priority: 0,
        directive: 'template',
      },
    ],
    '2017-02-01',
    0,
    0,
    0,
    0,
    [],
    { id: 'cat', name: 'Deposits' } as CategoryEntity,
    currencies[0],
  );
  expect(february.errors).toEqual([]);
  expect(february.to_budget).toBe(40000);
});

describe('a schedule two days after a one-time payday', () => {
  // Payday is Tue Dec 20, 2016, once; the deposit lands Thu Dec 22
  const occurrence = '2016-12-22';

  async function createAfterOneTimePayday(postsTransaction: boolean) {
    MockDate.set(new Date(2016, 11, 15, 12));
    const accountId = await db.insertAccount({
      name: 'Checking',
      offbudget: 0,
      closed: 0,
    });
    const payday = await createSchedule({
      schedule: { name: 'Payday' },
      conditions: [{ op: 'is', field: 'date', value: '2016-12-20' }],
    });
    const id = await createSchedule({
      schedule: { name: 'Deposit', posts_transaction: postsTransaction },
      conditions: [
        { op: 'is', field: 'account', value: accountId },
        { op: 'is', field: 'amount', value: -10000 },
        {
          op: 'isapprox',
          field: 'date',
          value: {
            relativeTo: {
              scheduleId: payday,
              offset: 2,
              unit: 'days',
              direction: 'after',
            },
          },
        },
      ],
    });
    expect((await getSchedule(id)).next_date).toBe(occurrence);
    MockDate.set(new Date(2017, 0, 1, 12));
    return { id, payday };
  }

  async function completeAfterPayday() {
    const ids = await createAfterOneTimePayday(false);
    const { _account } = await getSchedule(ids.id);
    await db.insertTransaction({
      account: _account,
      amount: -10000,
      date: occurrence,
      schedule: ids.id,
    });
    await advanceSchedulesService(true);
    expect((await getSchedule(ids.id)).completed).toBe(true);
    return ids;
  }

  const setPaydayDate = (payday: string, value: string | RecurConfig) =>
    schedulesApp.handlers['schedule/update']({
      schedule: { id: payday },
      conditions: [
        {
          op: typeof value === 'string' ? 'is' : 'isapprox',
          field: 'date',
          value,
        },
      ],
    });

  it('reopens when its source starts repeating', async () => {
    const { id, payday } = await completeAfterPayday();

    // Payday now repeats on the 20th; two days after is Sun Jan 22
    await setPaydayDate(payday, {
      ...paydayDate,
      start: '2016-12-20',
    });

    const schedule = await getSchedule(id);
    expect(schedule.completed).toBe(false);
    expect(schedule.next_date).toBe('2017-01-22');
  });

  it('stays completed when its one-time source moves to another one-time date', async () => {
    const { id, payday } = await completeAfterPayday();

    await setPaydayDate(payday, '2017-02-20');

    expect((await getSchedule(id)).completed).toBe(true);
  });

  it('is completed after its only occurrence posts', async () => {
    const { id } = await createAfterOneTimePayday(true);

    // As for a one-time schedule: one run posts, the next completes it
    await advanceSchedulesService(true);
    await advanceSchedulesService(true);

    const { data: transactions } = await aqlQuery(
      q('transactions').filter({ schedule: id }).select(['date']),
    );
    expect(transactions.map((t: { date: string }) => t.date)).toEqual([
      occurrence,
    ]);
    expect((await getSchedule(id)).completed).toBe(true);
  });

  it('is completed once its only occurrence is paid', async () => {
    const { id } = await createAfterOneTimePayday(false);
    const { _account } = await getSchedule(id);
    await db.insertTransaction({
      account: _account,
      amount: -10000,
      date: occurrence,
      schedule: id,
    });

    await advanceSchedulesService(true);

    expect((await getSchedule(id)).completed).toBe(true);
  });
});

it('never completes a schedule whose source still repeats', async () => {
  MockDate.set(new Date(2016, 11, 1, 12));
  const { id } = await createRelative('days');
  await setNextDate({ id });
  const { _account } = await getSchedule(id);
  await db.insertTransaction({
    account: _account,
    amount: -10000,
    date: december,
    schedule: id,
  });
  MockDate.set(new Date(2017, 0, 1, 12));

  await advanceSchedulesService(true);
  await advanceSchedulesService(true);

  const schedule = await getSchedule(id);
  expect(schedule.completed).toBe(false);
  expect(schedule.next_date).toBe('2017-01-08');
});

it('reads source dates afresh before advancing schedules', async () => {
  MockDate.set(new Date(2016, 11, 1, 12));
  const { id } = await createRelative('days');
  await setNextDate({ id });
  const { _account } = await getSchedule(id);
  await db.insertTransaction({
    account: _account,
    amount: -10000,
    date: december,
    schedule: id,
  });
  MockDate.set(new Date(2017, 0, 1, 12));
  // A stale lookup, as before a sync's refresh lands: the source looks gone
  setScheduleDates([]);

  await advanceSchedulesService(true);

  expect((await getSchedule(id)).completed).toBe(false);
});
