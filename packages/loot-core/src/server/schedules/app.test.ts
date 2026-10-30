// @ts-strict-ignore
import MockDate from 'mockdate';

import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { loadRules, updateRule } from '#server/transactions/transaction-rules';
import { undo } from '#server/undo';
import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import { businessCalendarPresets } from '#shared/business-calendar-presets';
import { q } from '#shared/query';
import {
  getScheduleDate,
  setScheduleDates,
} from '#shared/schedule-date-lookup';
import {
  computeSchedulePreviewTransactions,
  getNextDate,
} from '#shared/schedules';

import {
  advanceSchedulesService,
  areConditionValuesEqual,
  createSchedule,
  deleteSchedule,
  loadScheduleDateLookup,
  app as schedulesApp,
  setNextDate,
  skipNextDate,
  updateConditions,
  updateSchedule,
} from './app';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
});

describe('schedule app', () => {
  describe('utility', () => {
    it('conditions are updated when they exist', () => {
      const conds = [
        { op: 'is', field: 'payee', value: 'FOO' },
        { op: 'is', field: 'date', value: '2020-01-01' },
      ];

      const updated = updateConditions(conds, [
        {
          op: 'is',
          field: 'payee',
          value: 'bar',
        },
      ]);

      expect(updated.length).toBe(2);
      expect(updated[0].value).toBe('bar');
    });

    it("conditions are added if they don't exist", () => {
      const conds = [
        { op: 'contains', field: 'payee', value: 'FOO' },
        { op: 'contains', field: 'notes', value: 'dflksjdflskdjf' },
      ];

      const updated = updateConditions(conds, [
        {
          op: 'is',
          field: 'payee',
          value: 'bar',
        },
      ]);

      expect(updated.length).toBe(3);
    });

    it('getNextDate works with date conditions', () => {
      expect(
        getNextDate({ op: 'is', field: 'date', value: '2021-04-30' }),
      ).toBe('2021-04-30');

      expect(
        getNextDate({
          op: 'is',
          field: 'date',
          value: {
            start: '2020-12-20',
            frequency: 'monthly',
            patterns: [
              { type: 'day', value: 15 },
              { type: 'day', value: 30 },
            ],
          },
        }),
      ).toBe('2020-12-30');
    });

    it('areConditionValuesEqual matches nested objects regardless of key order', () => {
      expect(
        areConditionValuesEqual(
          {
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
            field: 'date',
          },
          {
            field: 'date',
            value: {
              patterns: [
                { value: 15, type: 'day' },
                { value: 30, type: 'day' },
              ],
              frequency: 'monthly',
              start: '2020-12-20',
            },
          },
        ),
      ).toBe(true);
    });

    it('areConditionValuesEqual returns false for different array ordering', () => {
      expect(
        areConditionValuesEqual(
          [{ field: 'date' }, { field: 'account' }],
          [{ field: 'account' }, { field: 'date' }],
        ),
      ).toBe(false);
    });

    it('areConditionValuesEqual distinguishes nullish values', () => {
      expect(areConditionValuesEqual(null, undefined)).toBe(false);
      expect(areConditionValuesEqual(undefined, undefined)).toBe(true);
    });
  });

  describe('methods', () => {
    it('createSchedule creates a schedule', async () => {
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      const {
        data: [row],
      } = await aqlQuery(q('schedules').filter({ id }).select('*'));

      expect(row).toBeTruthy();
      expect(row.rule).toBeTruthy();
      expect(row.next_date).toBe('2020-12-30');

      await expect(
        createSchedule({
          conditions: [{ op: 'is', field: 'payee', value: 'p1' }],
        }),
      ).rejects.toThrow(/date condition is required/);
    });

    it('identifies schedules with split actions', async () => {
      const id = await createSchedule({
        conditions: [{ op: 'is', field: 'date', value: '2020-12-20' }],
      });
      const { data: ruleId } = await aqlQuery(
        q('schedules').filter({ id }).calculate('rule'),
      );

      await updateRule({
        id: ruleId,
        actions: [
          {
            op: 'set',
            field: 'payee',
            value: 'destination-payee',
            options: { splitIndex: 0 },
          },
          { op: 'link-schedule', value: id },
        ],
      });

      const { data: parentActionMatches } = await aqlQuery(
        q('schedules').filter({ _has_splits: true }).select(['id']),
      );
      expect(parentActionMatches).toEqual([]);

      await updateRule({
        id: ruleId,
        actions: [
          {
            op: 'set',
            field: 'payee',
            value: 'destination-payee',
            options: { splitIndex: 1 },
          },
          { op: 'link-schedule', value: id },
        ],
      });

      const { data: splitActionMatches } = await aqlQuery(
        q('schedules').filter({ _has_splits: true }).select(['id']),
      );

      expect(splitActionMatches).toEqual([{ id }]);
    });

    it('trims schedule names when creating and updating schedules', async () => {
      const id = await createSchedule({
        schedule: { name: '  Rent  ' },
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: '2020-12-20',
          },
        ],
      });

      let res = await aqlQuery(q('schedules').filter({ id }).select(['name']));
      expect(res.data[0].name).toBe('Rent');

      await updateSchedule({
        schedule: { id, name: '  Mortgage  ' },
      });

      res = await aqlQuery(q('schedules').filter({ id }).select(['name']));
      expect(res.data[0].name).toBe('Mortgage');
    });

    it('treats names as duplicates after trimming whitespace', async () => {
      await createSchedule({
        schedule: { name: 'Rent' },
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: '2020-12-20',
          },
        ],
      });

      await expect(
        createSchedule({
          schedule: { name: '  Rent  ' },
          conditions: [
            {
              op: 'is',
              field: 'date',
              value: '2020-12-20',
            },
          ],
        }),
      ).rejects.toThrow(/same name/);
    });

    it('updateSchedule updates a schedule', async () => {
      const id = await createSchedule({
        conditions: [
          { op: 'is', field: 'payee', value: 'foo' },
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      let res = await aqlQuery(
        q('schedules')
          .filter({ id })
          .select(['next_date', 'posts_transaction']),
      );
      let row = res.data[0];

      expect(row.next_date).toBe('2020-12-30');
      expect(row.posts_transaction).toBe(false);

      MockDate.set(new Date(2021, 4, 17));

      await updateSchedule({
        schedule: { id, posts_transaction: true },
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 18 },
                { type: 'day', value: 29 },
              ],
            },
          },
        ],
      });

      res = await aqlQuery(
        q('schedules')
          .filter({ id })
          .select(['next_date', 'posts_transaction']),
      );
      row = res.data[0];

      // Updating the date condition updates `next_date`
      expect(row.next_date).toBe('2021-05-18');
      expect(row.posts_transaction).toBe(true);
    });

    it('updateSchedule does not update `next_date` when unrelated conditions change', async () => {
      const id = await createSchedule({
        conditions: [
          { op: 'is', field: 'payee', value: 'foo' },
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      MockDate.set(new Date(2021, 4, 17));

      await updateSchedule({
        schedule: { id },
        conditions: [{ op: 'is', field: 'payee', value: 'bar' }],
      });

      const {
        data: [row],
      } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

      expect(row.next_date).toBe('2020-12-30');
    });

    it('updateSchedule ignores the condition `type` field when date value is unchanged', async () => {
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      MockDate.set(new Date(2021, 4, 17));

      await updateSchedule({
        schedule: { id },
        conditions: [
          {
            op: 'is',
            field: 'date',
            type: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      const {
        data: [row],
      } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

      expect(row.next_date).toBe('2020-12-30');
    });

    it('deleteSchedule deletes a schedule', async () => {
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      const { data: schedules } = await aqlQuery(q('schedules').select('*'));
      expect(schedules.length).toBe(1);

      await deleteSchedule({ id });
      const { data: schedules2 } = await aqlQuery(q('schedules').select('*'));
      expect(schedules2.length).toBe(0);
    });

    it('setNextDate sets `next_date`', async () => {
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      const { data: ruleId } = await aqlQuery(
        q('schedules').filter({ id }).calculate('rule'),
      );

      // Manually update the rule
      await updateRule({
        id: ruleId,
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 18 },
                { type: 'day', value: 28 },
              ],
            },
          },
        ],
      });

      let res = await aqlQuery(
        q('schedules').filter({ id }).select(['next_date']),
      );
      let row = res.data[0];

      expect(row.next_date).toBe('2020-12-30');

      await setNextDate({ id });

      res = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));
      row = res.data[0];

      expect(row.next_date).toBe('2021-05-18');
    });

    it('skipNextDate skips `next_date`', async () => {
      /* Dec 2020 calendar for reference:
        | Su | Mo | Tu | We | Th | Fr | Sa |
        |    |    | 01 | 02 | 03 | 04 | 05 |
        | 06 | 07 | 08 | 09 | 10 | 11 | 12 |
        | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
        | 20 | 21 | 22 | 23 | 24 | 25 | 26 |
        | 27 | 28 | 29 | 30 | 31 |
        */
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-05',
              frequency: 'weekly',
              patterns: [],
            },
          },
        ],
      });

      let res = await aqlQuery(
        q('schedules').filter({ id }).select(['next_date']),
      );
      let row = res.data[0];

      expect(row.next_date).toBe('2020-12-05');

      await skipNextDate({ id });

      res = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));
      row = res.data[0];

      expect(row.next_date).toBe('2020-12-12');
    });

    it('skipNextDate skips `next_date` moving `after` weekend', async () => {
      /* Dec 2020 calendar for reference:
        | Su | Mo | Tu | We | Th | Fr | Sa |
        |    |    | 01 | 02 | 03 | 04 | 05 |
        | 06 | 07 | 08 | 09 | 10 | 11 | 12 |
        | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
        | 20 | 21 | 22 | 23 | 24 | 25 | 26 |
        | 27 | 28 | 29 | 30 | 31 |
        */
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-05',
              frequency: 'weekly',
              patterns: [],
              skipWeekend: true,
              weekendSolveMode: 'after',
            },
          },
        ],
      });

      let res = await aqlQuery(
        q('schedules').filter({ id }).select(['next_date']),
      );
      let row = res.data[0];

      expect(row.next_date).toBe('2020-12-07');

      await skipNextDate({ id });

      res = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));
      row = res.data[0];

      expect(row.next_date).toBe('2020-12-14');
    });

    it('skipNextDate skips `next_date` moving `before` weekend', async () => {
      /* Dec 2020 calendar for reference:
        | Su | Mo | Tu | We | Th | Fr | Sa |
        |    |    | 01 | 02 | 03 | 04 | 05 |
        | 06 | 07 | 08 | 09 | 10 | 11 | 12 |
        | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
        | 20 | 21 | 22 | 23 | 24 | 25 | 26 |
        | 27 | 28 | 29 | 30 | 31 |
        */
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-05',
              frequency: 'weekly',
              patterns: [],
              skipWeekend: true,
              weekendSolveMode: 'before',
            },
          },
        ],
      });

      let res = await aqlQuery(
        q('schedules').filter({ id }).select(['next_date']),
      );
      let row = res.data[0];

      expect(row.next_date).toBe('2020-12-04');

      await skipNextDate({ id });

      res = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));
      row = res.data[0];

      expect(row.next_date).toBe('2020-12-11');
    });

    it('skipNextDate keeps the next occurrence when moving `before` weekend', async () => {
      /* Dec 2020 calendar for reference:
        | Su | Mo | Tu | We | Th | Fr | Sa |
        |    |    | 01 | 02 | 03 | 04 | 05 |
        | 06 | 07 | 08 | 09 | 10 | 11 | 12 |
        | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
        | 20 | 21 | 22 | 23 | 24 | 25 | 26 |
        | 27 | 28 | 29 | 30 | 31 |
        */
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-04',
              frequency: 'daily',
              patterns: [],
              skipWeekend: true,
              weekendSolveMode: 'before',
            },
          },
        ],
      });

      let res = await aqlQuery(
        q('schedules').filter({ id }).select(['next_date']),
      );
      let row = res.data[0];

      expect(row.next_date).toBe('2020-12-04');

      await skipNextDate({ id });

      res = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));
      row = res.data[0];

      expect(row.next_date).toBe('2020-12-07');
    });

    it('createSchedule keeps an occurrence moved `after` the weekend onto a later day', async () => {
      // Tests run on Sunday 1 January 2017. Saturday 31 December moves to
      // Monday 2 January, which is still ahead, so it is the next date.
      for (const frequency of ['weekly', 'monthly'] as const) {
        const id = await createSchedule({
          schedule: { name: frequency },
          conditions: [
            {
              op: 'is',
              field: 'date',
              value: {
                start: '2016-12-31',
                frequency,
                patterns: [],
                skipWeekend: true,
                weekendSolveMode: 'after',
              },
            },
          ],
        });

        const {
          data: [row],
        } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

        expect(row.next_date).toBe('2017-01-02');
      }
    });

    it('updateSchedule keeps an occurrence moved `after` the weekend onto a later day', async () => {
      const id = await createSchedule({
        conditions: [{ op: 'is', field: 'date', value: '2020-12-20' }],
      });

      // Edited on Sunday 23 May: Saturday 22 May moves to Monday 24 May,
      // which is still ahead, so it is the next date.
      MockDate.set(new Date(2021, 4, 23, 12));

      try {
        await updateSchedule({
          schedule: { id },
          conditions: [
            {
              op: 'is',
              field: 'date',
              value: {
                start: '2021-05-22',
                frequency: 'weekly',
                patterns: [],
                skipWeekend: true,
                weekendSolveMode: 'after',
              },
            },
          ],
        });

        const {
          data: [row],
        } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

        expect(row.next_date).toBe('2021-05-24');
      } finally {
        MockDate.reset();
      }
    });

    it('createSchedule uses the local day west of UTC', async () => {
      // `new Date('2017-01-01')` is UTC midnight, which is still Saturday
      // 31 December in New York, so that past Saturday became the next date.
      const tz = process.env.TZ;
      process.env.TZ = 'America/New_York';

      try {
        const id = await createSchedule({
          conditions: [
            {
              op: 'is',
              field: 'date',
              value: {
                start: '2016-12-24',
                frequency: 'weekly',
                patterns: [],
              },
            },
          ],
        });

        const {
          data: [row],
        } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

        expect(row.next_date).toBe('2017-01-07');
      } finally {
        process.env.TZ = tz;
      }
    });

    it('createSchedule keeps the last date of a schedule that has ended', async () => {
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2016-11-07',
              frequency: 'weekly',
              patterns: [],
              endMode: 'after_n_occurrences',
              endOccurrences: 2,
            },
          },
        ],
      });

      const {
        data: [row],
      } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

      expect(row.next_date).toBe('2016-11-14');
    });

    it('auto-posts every missed recurring occurrence while catching up', async () => {
      MockDate.set(new Date(2016, 11, 31, 12));
      schedulesApp.startServices();

      try {
        const accountId = await db.insertAccount({
          name: 'Checking',
          offbudget: 0,
          closed: 0,
        });

        const id = await createSchedule({
          schedule: { posts_transaction: true },
          conditions: [
            {
              op: 'is',
              field: 'account',
              value: accountId,
            },
            {
              op: 'is',
              field: 'amount',
              value: -10000,
            },
            {
              op: 'is',
              field: 'date',
              value: {
                start: '2016-12-05',
                frequency: 'weekly',
                interval: 2,
                patterns: [],
              },
            },
          ],
        });
        const nextDateRow = await db.first<{
          id: string;
        }>('SELECT id FROM schedules_next_date WHERE schedule_id = ?', [id]);

        await db.update('schedules_next_date', {
          id: nextDateRow.id,
          local_next_date: 20161205,
          local_next_date_ts: Date.now(),
          base_next_date: 20161205,
          base_next_date_ts: Date.now(),
        });

        await advanceSchedulesService(true);

        const { data: transactions } = await aqlQuery(
          q('transactions')
            .filter({ schedule: id })
            .select(['date', 'amount'])
            .orderBy({ date: 'asc' }),
        );

        expect(
          transactions.map(({ date, amount }) => ({ date, amount })),
        ).toEqual([
          { date: '2016-12-05', amount: -10000 },
          { date: '2016-12-19', amount: -10000 },
        ]);

        const {
          data: [schedule],
        } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

        expect(schedule.next_date).toBe('2017-01-02');
      } finally {
        MockDate.reset();
        await schedulesApp.stopServices();
      }
    });

    it('continues auto-post catch-up after an already paid occurrence', async () => {
      MockDate.set(new Date(2016, 11, 31, 12));
      schedulesApp.startServices();

      try {
        const accountId = await db.insertAccount({
          name: 'Checking',
          offbudget: 0,
          closed: 0,
        });

        const id = await createSchedule({
          schedule: { posts_transaction: true },
          conditions: [
            {
              op: 'is',
              field: 'account',
              value: accountId,
            },
            {
              op: 'is',
              field: 'amount',
              value: -10000,
            },
            {
              op: 'is',
              field: 'date',
              value: {
                start: '2016-12-05',
                frequency: 'weekly',
                interval: 2,
                patterns: [],
              },
            },
          ],
        });
        const nextDateRow = await db.first<{
          id: string;
        }>('SELECT id FROM schedules_next_date WHERE schedule_id = ?', [id]);

        await db.update('schedules_next_date', {
          id: nextDateRow.id,
          local_next_date: 20161205,
          local_next_date_ts: Date.now(),
          base_next_date: 20161205,
          base_next_date_ts: Date.now(),
        });
        await db.insertTransaction({
          account: accountId,
          amount: -10000,
          date: '2016-12-05',
          schedule: id,
        });

        await advanceSchedulesService(true);

        const { data: transactions } = await aqlQuery(
          q('transactions')
            .filter({ schedule: id })
            .select(['date', 'amount'])
            .orderBy({ date: 'asc' }),
        );

        expect(
          transactions.map(({ date, amount }) => ({ date, amount })),
        ).toEqual([
          { date: '2016-12-05', amount: -10000 },
          { date: '2016-12-19', amount: -10000 },
        ]);

        const {
          data: [schedule],
        } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

        expect(schedule.next_date).toBe('2017-01-02');
      } finally {
        MockDate.reset();
        await schedulesApp.stopServices();
      }
    });

    it('catches up an auto-post schedule moved `before` a weekend occurrence', async () => {
      /* Dec 2016 / Jan 2017 calendar for reference:
        | Su | Mo | Tu | We | Th | Fr | Sa |
        | 18 | 19 | 20 | 21 | 22 | 23 | 24 |
        | 25 | 26 | 27 | 28 | 29 | 30 | 31 |
        | 01 | 02 | 03 | 04 | 05 | 06 | 07 |
        */
      MockDate.set(new Date(2016, 11, 31, 12));
      schedulesApp.startServices();

      try {
        const accountId = await db.insertAccount({
          name: 'Checking',
          offbudget: 0,
          closed: 0,
        });

        const id = await createSchedule({
          schedule: { posts_transaction: true },
          conditions: [
            {
              op: 'is',
              field: 'account',
              value: accountId,
            },
            {
              op: 'is',
              field: 'amount',
              value: -10000,
            },
            {
              op: 'is',
              field: 'date',
              value: {
                start: '2016-12-24',
                frequency: 'weekly',
                interval: 1,
                patterns: [],
                skipWeekend: true,
                weekendSolveMode: 'before',
              },
            },
          ],
        });
        const nextDateRow = await db.first<{
          id: string;
        }>('SELECT id FROM schedules_next_date WHERE schedule_id = ?', [id]);

        await db.update('schedules_next_date', {
          id: nextDateRow.id,
          local_next_date: 20161223,
          local_next_date_ts: Date.now(),
          base_next_date: 20161223,
          base_next_date_ts: Date.now(),
        });
        await db.insertTransaction({
          account: accountId,
          amount: -10000,
          date: '2016-12-23',
          schedule: id,
        });

        await advanceSchedulesService(true);

        const { data: transactions } = await aqlQuery(
          q('transactions')
            .filter({ schedule: id })
            .select(['date', 'amount'])
            .orderBy({ date: 'asc' }),
        );

        expect(
          transactions.map(({ date, amount }) => ({ date, amount })),
        ).toEqual([
          { date: '2016-12-23', amount: -10000 },
          { date: '2016-12-30', amount: -10000 },
        ]);

        const {
          data: [schedule],
        } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

        expect(schedule.next_date).toBe('2017-01-06');
      } finally {
        MockDate.reset();
        await schedulesApp.stopServices();
      }
    });

    it('completes one-time auto-post schedules that are already paid', async () => {
      MockDate.set(new Date(2016, 11, 31, 12));
      schedulesApp.startServices();

      try {
        const accountId = await db.insertAccount({
          name: 'Checking',
          offbudget: 0,
          closed: 0,
        });

        const id = await createSchedule({
          schedule: { posts_transaction: true },
          conditions: [
            {
              op: 'is',
              field: 'account',
              value: accountId,
            },
            {
              op: 'is',
              field: 'amount',
              value: -10000,
            },
            {
              op: 'is',
              field: 'date',
              value: '2016-12-05',
            },
          ],
        });
        await db.insertTransaction({
          account: accountId,
          amount: -10000,
          date: '2016-12-05',
          schedule: id,
        });

        await advanceSchedulesService(true);

        const {
          data: [schedule],
        } = await aqlQuery(q('schedules').filter({ id }).select(['completed']));

        expect(schedule.completed).toBe(true);

        const { data: transactions } = await aqlQuery(
          q('transactions').filter({ schedule: id }).select(['date']),
        );

        expect(transactions).toHaveLength(1);
      } finally {
        MockDate.reset();
        await schedulesApp.stopServices();
      }
    });

    it('auto-posts one-time schedules that are due', async () => {
      MockDate.set(new Date(2016, 11, 31, 12));
      schedulesApp.startServices();

      try {
        const accountId = await db.insertAccount({
          name: 'Checking',
          offbudget: 0,
          closed: 0,
        });

        const id = await createSchedule({
          schedule: { posts_transaction: true },
          conditions: [
            {
              op: 'is',
              field: 'account',
              value: accountId,
            },
            {
              op: 'is',
              field: 'amount',
              value: -10000,
            },
            {
              op: 'is',
              field: 'date',
              value: '2016-12-31',
            },
          ],
        });

        await advanceSchedulesService(true);

        const { data: transactions } = await aqlQuery(
          q('transactions').filter({ schedule: id }).select(['date', 'amount']),
        );

        expect(
          transactions.map(({ date, amount }) => ({ date, amount })),
        ).toEqual([{ date: '2016-12-31', amount: -10000 }]);
      } finally {
        MockDate.reset();
        await schedulesApp.stopServices();
      }
    });

    it('keeps a schedule posted today paid for the rest of the day', async () => {
      // In tests `currentDay()` is fixed at 2017-01-01, so that is "today".
      MockDate.set(new Date(2016, 11, 31, 12));
      schedulesApp.startServices();

      try {
        const accountId = await db.insertAccount({
          name: 'Checking',
          offbudget: 0,
          closed: 0,
        });

        const id = await createSchedule({
          schedule: { posts_transaction: true },
          conditions: [
            {
              op: 'is',
              field: 'account',
              value: accountId,
            },
            {
              op: 'is',
              field: 'amount',
              value: -10000,
            },
            {
              op: 'is',
              field: 'date',
              value: {
                start: '2016-12-18',
                frequency: 'weekly',
                interval: 1,
                patterns: [],
              },
            },
          ],
        });
        const nextDateRow = await db.first<{
          id: string;
        }>('SELECT id FROM schedules_next_date WHERE schedule_id = ?', [id]);

        await db.update('schedules_next_date', {
          id: nextDateRow.id,
          local_next_date: 20170101,
          local_next_date_ts: Date.now(),
          base_next_date: 20170101,
          base_next_date_ts: Date.now(),
        });

        await advanceSchedulesService(true);

        const { data: transactions } = await aqlQuery(
          q('transactions')
            .filter({ schedule: id })
            .select(['date', 'amount'])
            .orderBy({ date: 'asc' }),
        );

        expect(
          transactions.map(({ date, amount }) => ({ date, amount })),
        ).toEqual([{ date: '2017-01-01', amount: -10000 }]);

        const {
          data: [schedule],
        } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

        expect(schedule.next_date).toBe('2017-01-01');

        // A same-day re-run (e.g. offline retry) neither posts again nor
        // advances; the schedule stays paid on today's date. Advancement on
        // a later day is covered by the catch-up tests above.
        await advanceSchedulesService(true);

        const { data: transactionsAfter } = await aqlQuery(
          q('transactions')
            .filter({ schedule: id })
            .select(['date', 'amount'])
            .orderBy({ date: 'asc' }),
        );

        expect(transactionsAfter).toHaveLength(1);

        const {
          data: [scheduleAfter],
        } = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));

        expect(scheduleAfter.next_date).toBe('2017-01-01');
      } finally {
        MockDate.reset();
        await schedulesApp.stopServices();
      }
    });

    it('keeps a `set amount` action in sync when the amount is edited', async () => {
      MockDate.set(new Date(2016, 11, 31, 12));
      schedulesApp.startServices();

      try {
        const accountId = await db.insertAccount({
          name: 'Checking',
          offbudget: 0,
          closed: 0,
        });

        const id = await createSchedule({
          schedule: { posts_transaction: true },
          conditions: [
            { op: 'is', field: 'account', value: accountId },
            { op: 'is', field: 'amount', value: -6000 },
            { op: 'is', field: 'date', value: '2016-12-31' },
          ],
        });

        // Some schedules have a rule that also *sets* the amount (e.g. a rule
        // customized via "Edit as rule"). Posting runs the rule, so the action
        // value must track the amount condition.
        const { data: ruleId } = await aqlQuery(
          q('schedules').filter({ id }).calculate('rule'),
        );
        const ruleRow = await db.first<Pick<db.DbRule, 'actions'>>(
          'SELECT actions FROM rules WHERE id = ?',
          [ruleId],
        );
        await updateRule({
          id: ruleId,
          actions: [
            { op: 'set', field: 'amount', value: -6000 },
            ...JSON.parse(ruleRow.actions),
          ],
        });

        // Edit the amount in the schedule editor (condition only).
        await updateSchedule({
          schedule: { id },
          conditions: [
            { op: 'is', field: 'account', value: accountId },
            { op: 'is', field: 'date', value: '2016-12-31' },
            { op: 'is', field: 'amount', value: -8000 },
          ],
        });

        await advanceSchedulesService(true);

        const { data: transactions } = await aqlQuery(
          q('transactions').filter({ schedule: id }).select(['amount']),
        );

        expect(transactions.map(({ amount }) => amount)).toEqual([-8000]);
      } finally {
        MockDate.reset();
        await schedulesApp.stopServices();
      }
    });
  });

  describe('auto-post service throttling', () => {
    const dateCondition = {
      op: 'is',
      field: 'date',
      value: '2020-12-01',
    } as const;

    beforeEach(async () => {
      await prefs.loadPrefs();
      await prefs.savePrefs({ lastScheduleRun: '2020-12-01' });
    });

    afterEach(() => {
      prefs.unloadPrefs();
    });

    it('clears the marker when a schedule that posts transactions is created', async () => {
      await createSchedule({
        schedule: { posts_transaction: true },
        conditions: [dateCondition],
      });

      expect(prefs.getPrefs().lastScheduleRun).toBeUndefined();
    });

    it('keeps the marker when the created schedule does not post transactions', async () => {
      await createSchedule({
        schedule: { posts_transaction: false },
        conditions: [dateCondition],
      });

      expect(prefs.getPrefs().lastScheduleRun).toBe('2020-12-01');
    });

    it('clears the marker when a schedule starts posting transactions', async () => {
      const id = await createSchedule({ conditions: [dateCondition] });

      await updateSchedule({ schedule: { id, posts_transaction: true } });

      expect(prefs.getPrefs().lastScheduleRun).toBeUndefined();
    });

    it('clears the marker when updating a schedule that already posts transactions', async () => {
      const id = await createSchedule({
        schedule: { posts_transaction: true },
        conditions: [dateCondition],
      });

      await prefs.savePrefs({ lastScheduleRun: '2020-12-01' });

      await updateSchedule({ schedule: { id, name: 'Renamed schedule' } });

      expect(prefs.getPrefs().lastScheduleRun).toBeUndefined();
    });

    it('keeps the marker when updating a schedule that does not post transactions', async () => {
      const id = await createSchedule({ conditions: [dateCondition] });

      await updateSchedule({ schedule: { id, name: 'Renamed schedule' } });

      expect(prefs.getPrefs().lastScheduleRun).toBe('2020-12-01');
    });
  });
});

describe('schedule business calendars', () => {
  afterEach(() => {
    setBusinessCalendars([]);
    MockDate.reset();
  });

  it("upcoming dates move off the chosen calendar's non-business days", async () => {
    MockDate.set(new Date(2026, 5, 15));
    setBusinessCalendars([
      {
        id: 'federal',
        name: 'Federal',
        ...businessCalendarPresets[0].calendar,
      },
    ]);
    const config = {
      start: '2026-01-04',
      frequency: 'monthly' as const,
      skipWeekend: true,
      weekendSolveMode: 'before' as const,
      businessCalendarId: 'federal',
    };

    expect(
      await schedulesApp.handlers['schedule/get-upcoming-dates']({
        config,
        count: 2,
      }),
    ).toEqual(['2026-07-02', '2026-08-04']);
    expect(
      await schedulesApp.handlers['schedule/get-upcoming-dates']({
        config: { ...config, businessCalendarId: undefined },
        count: 1,
      }),
    ).toEqual(['2026-07-03']);
  });
});

describe('schedule business calendars: Next date and preview agree', () => {
  afterEach(() => {
    setBusinessCalendars([]);
    MockDate.reset();
  });

  it('Next date and preview agree: next date, upcoming dates and preview move off a holiday', async () => {
    // Tests fix "today" at 2017-01-01; keep the clock on the same day
    MockDate.set(new Date(2017, 0, 1));
    setBusinessCalendars([
      {
        id: 'federal',
        name: 'U.S. Federal Holidays',
        ...businessCalendarPresets[0].calendar,
      },
    ]);
    // Mondays, moved after non-business days. The first, January 2, 2017, is
    // the New Year's Day observance; January 16 is Martin Luther King Jr. Day
    const config = {
      start: '2017-01-02',
      frequency: 'weekly' as const,
      skipWeekend: true,
      weekendSolveMode: 'after' as const,
      businessCalendarId: 'federal',
    };
    const id = await createSchedule({
      schedule: { custom_upcoming_length: 'oneMonth' },
      conditions: [{ op: 'isapprox', field: 'date', value: config }],
    });
    const { data: schedules } = await aqlQuery(
      q('schedules').filter({ id }).select('*'),
    );

    const nextDate = schedules[0].next_date;
    const upcoming = await schedulesApp.handlers['schedule/get-upcoming-dates'](
      { config, count: 4 },
    );
    const preview = computeSchedulePreviewTransactions(
      schedules,
      new Map([[id, 'upcoming']]),
    )
      .map(t => t.date)
      .sort();

    expect(nextDate).toBe('2017-01-03');
    expect(upcoming).toEqual([
      '2017-01-03',
      '2017-01-09',
      '2017-01-17',
      '2017-01-23',
    ]);
    expect(preview.slice(0, 4)).toEqual(upcoming);
  });
});

describe('relative schedules', () => {
  const federal = {
    id: 'federal',
    name: 'U.S. Federal Holidays',
    ...businessCalendarPresets[0].calendar,
  };
  const paydayDate = {
    start: '2026-01-15',
    frequency: 'monthly' as const,
    skipWeekend: true,
    weekendSolveMode: 'before' as const,
    businessCalendarId: 'federal',
  };
  const relativeTo = (scheduleId: string) => ({
    relativeTo: {
      scheduleId,
      offset: 2,
      unit: 'business-days' as const,
      direction: 'before' as const,
    },
    businessCalendarId: 'federal',
  });
  const nextDate = async (id: string) =>
    (await aqlQuery(q('schedules').filter({ id }).calculate('next_date'))).data;

  beforeEach(() => {
    MockDate.set(new Date(2026, 10, 1));
    setBusinessCalendars([federal]);
  });

  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
    MockDate.reset();
  });

  it('computes the next date of a schedule relative to another', async () => {
    const payday = await createSchedule({
      conditions: [{ op: 'isapprox', field: 'date', value: paydayDate }],
    });
    const deposit = await createSchedule({
      conditions: [
        { op: 'isapprox', field: 'date', value: relativeTo(payday) },
      ],
    });

    // Tests fix "today" at 2017-01-01, so stored next dates are the first
    // occurrences: payday Thu Jan 15, 2026 and two business days before it
    expect(await nextDate(payday)).toBe('2026-01-15');
    expect(await nextDate(deposit)).toBe('2026-01-13');
    expect(
      await schedulesApp.handlers['schedule/get-upcoming-dates']({
        config: relativeTo(payday),
        count: 2,
      }),
    ).toEqual(['2026-11-10', '2026-12-11']);
  });

  it('rejects a schedule relative to itself or to a relative schedule', async () => {
    const payday = await createSchedule({
      conditions: [{ op: 'isapprox', field: 'date', value: paydayDate }],
    });
    const deposit = await createSchedule({
      conditions: [
        { op: 'isapprox', field: 'date', value: relativeTo(payday) },
      ],
    });

    await expect(
      createSchedule({
        conditions: [
          { op: 'isapprox', field: 'date', value: relativeTo(deposit) },
        ],
      }),
    ).rejects.toThrow('another relative schedule');
    await expect(
      updateSchedule({
        schedule: { id: deposit },
        conditions: [
          { op: 'isapprox', field: 'date', value: relativeTo(deposit) },
        ],
      }),
    ).rejects.toThrow('relative to itself');
    await expect(
      updateSchedule({
        schedule: { id: payday },
        conditions: [
          { op: 'isapprox', field: 'date', value: relativeTo('other') },
        ],
      }),
    ).rejects.toThrow('Other schedules are relative to this one');
    const huge = relativeTo(payday);
    huge.relativeTo.offset = 1_000_000_000;
    await expect(
      createSchedule({
        conditions: [{ op: 'isapprox', field: 'date', value: huge }],
      }),
    ).rejects.toThrow('whole number from 0 to 366');
  });

  it('Skip the source: skipping the source leaves the relative next date unchanged', async () => {
    const payday = await createSchedule({
      conditions: [{ op: 'isapprox', field: 'date', value: paydayDate }],
    });
    const deposit = await createSchedule({
      conditions: [
        { op: 'isapprox', field: 'date', value: relativeTo(payday) },
      ],
    });
    expect(await nextDate(deposit)).toBe('2026-01-13');

    await schedulesApp.handlers['schedule/skip-next-date']({ id: payday });

    expect(await nextDate(payday)).not.toBe('2026-01-15');
    expect(await nextDate(deposit)).toBe('2026-01-13');
  });

  it('follows source edits and deletion, and undo restores dates', async () => {
    const create = schedulesApp.handlers['schedule/create'];
    const payday = await create({
      conditions: [{ op: 'isapprox', field: 'date', value: paydayDate }],
    });
    const deposit = await create({
      conditions: [
        { op: 'isapprox', field: 'date', value: relativeTo(payday) },
      ],
    });
    expect(await nextDate(deposit)).toBe('2026-01-13');

    // Payday moves to the 20th. Recomputed next dates use the real clock
    // (mocked to Nov 1, 2026): payday Fri Nov 20 -> deposit Wed Nov 18
    await schedulesApp.handlers['schedule/update']({
      schedule: { id: payday },
      conditions: [
        {
          op: 'isapprox',
          field: 'date',
          value: { ...paydayDate, start: '2026-01-20' },
        },
      ],
    });
    expect(await nextDate(deposit)).toBe('2026-11-18');

    await schedulesApp.handlers['schedule/delete']({ id: payday });
    expect(await nextDate(deposit)).toBeFalsy();

    await undo();
    await vi.waitFor(async () =>
      expect(await nextDate(deposit)).toBe('2026-11-18'),
    );
  });

  it('loads schedule dates when a budget opens', async () => {
    const payday = await createSchedule({
      conditions: [{ op: 'isapprox', field: 'date', value: paydayDate }],
    });
    setScheduleDates([]);

    await loadScheduleDateLookup();
    expect(getScheduleDate(payday)).toEqual(paydayDate);
  });
});

describe('upcoming dates after a skip', () => {
  const weekly = {
    start: '2026-10-03',
    frequency: 'weekly' as const,
    patterns: [],
  };
  const upcoming = (args: { config: unknown; scheduleId?: string }) =>
    schedulesApp.handlers['schedule/get-upcoming-dates']({ ...args, count: 3 });

  beforeEach(() => {
    MockDate.set(new Date(2026, 9, 1, 12));
  });

  afterEach(() => {
    MockDate.reset();
  });

  it('start from the stored next date once a date is skipped', async () => {
    const id = await createSchedule({
      conditions: [{ op: 'isapprox', field: 'date', value: weekly }],
    });
    await skipNextDate({ id });

    expect(await upcoming({ config: weekly, scheduleId: id })).toEqual([
      '2026-10-10',
      '2026-10-17',
      '2026-10-24',
    ]);
  });

  it('keep a date moved after the weekend onto the stored next date', async () => {
    const moved = {
      ...weekly,
      skipWeekend: true,
      weekendSolveMode: 'after' as const,
    };
    const id = await createSchedule({
      conditions: [{ op: 'isapprox', field: 'date', value: moved }],
    });
    // Saturdays move to Mondays: Oct 5 is skipped, so Oct 10 (shown Oct 12) is next
    await skipNextDate({ id });

    expect(await upcoming({ config: moved, scheduleId: id })).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
  });

  it('preview new and edited dates from today, as before', async () => {
    const id = await createSchedule({
      conditions: [{ op: 'isapprox', field: 'date', value: weekly }],
    });
    await skipNextDate({ id });

    const fromToday = ['2026-10-03', '2026-10-10', '2026-10-17'];
    // A new schedule has no stored next date
    expect(await upcoming({ config: weekly })).toEqual(fromToday);
    // An edited date no longer matches the stored next date
    expect(
      await upcoming({
        config: { ...weekly, start: '2026-10-02' },
        scheduleId: id,
      }),
    ).toEqual(['2026-10-02', '2026-10-09', '2026-10-16']);
  });

  it('start a relative schedule from its stored next date until its offset changes', async () => {
    const payday = await createSchedule({
      conditions: [
        {
          op: 'isapprox',
          field: 'date',
          value: { start: '2026-10-10', frequency: 'monthly', patterns: [] },
        },
      ],
    });
    const twoDaysBefore = {
      relativeTo: {
        scheduleId: payday,
        offset: 2,
        unit: 'days' as const,
        direction: 'before' as const,
      },
    };
    const id = await createSchedule({
      conditions: [{ op: 'isapprox', field: 'date', value: twoDaysBefore }],
    });
    // Oct 8 is skipped, so Nov 8 is next
    await skipNextDate({ id });

    expect(await upcoming({ config: twoDaysBefore, scheduleId: id })).toEqual([
      '2026-11-08',
      '2026-12-08',
      '2027-01-08',
    ]);
    // Three days before no longer lands on Nov 8, so it starts from today
    const threeDaysBefore = {
      ...twoDaysBefore,
      relativeTo: { ...twoDaysBefore.relativeTo, offset: 3 },
    };
    expect(await upcoming({ config: threeDaysBefore, scheduleId: id })).toEqual(
      ['2026-10-07', '2026-11-07', '2026-12-07'],
    );
  });
});
