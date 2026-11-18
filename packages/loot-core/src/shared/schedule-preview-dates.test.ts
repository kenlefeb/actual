// Fork-only (sc-4973, openspec/changes/native-register-upcoming-rows D12).
// "Preview dates come from one generator": `schedulePreviewDates` yields a
// schedule's preview dates lazily, and the web preview drains it with its
// output unchanged. The fixture holds `computeSchedulePreviewTransactions`'s
// output from before the generator; regenerate it only on purpose.
import type { RuleConditionEntity, ScheduleEntity } from '#types/models';

import { setBusinessCalendars } from './business-calendar-lookup';
import { businessCalendarPresets } from './business-calendar-presets';
import { setScheduleDates } from './schedule-date-lookup';
import {
  computeSchedulePreviewTransactions,
  getNextDate,
  schedulePreviewDates,
} from './schedules';
import type { ScheduleStatuses } from './schedules';

function makeSchedule(
  id: string,
  next_date: string,
  date: unknown,
  over: Partial<ScheduleEntity> = {},
): ScheduleEntity {
  return {
    id,
    rule: `rule-${id}`,
    next_date,
    completed: false,
    posts_transaction: false,
    tombstone: false,
    _payee: 'payee',
    _account: 'account',
    _amount: -1000,
    _amountOp: 'is',
    _date: date as ScheduleEntity['_date'],
    _actions: [],
    _conditions: [
      { field: 'date', op: 'isapprox', value: date } as RuleConditionEntity,
    ],
    ...over,
  };
}

const recur = (start: string, over: Record<string, unknown> = {}) => ({
  start,
  frequency: 'daily',
  patterns: [],
  skipWeekend: false,
  weekendSolveMode: 'after',
  ...over,
});

const SCHEDULES = {
  // The skip forward to the day after each date
  daily: makeSchedule('daily', '2017-01-01', recur('2017-01-01')),
  weekly: makeSchedule(
    'weekly',
    '2017-01-02',
    recur('2017-01-02', { frequency: 'weekly' }),
    { custom_upcoming_length: '1-month' },
  ),
  // Saturdays and Sundays move back to Friday: repeated dates are dropped
  weekends: makeSchedule(
    'weekends',
    '2017-01-02',
    recur('2017-01-02', { skipWeekend: true, weekendSolveMode: 'before' }),
    { custom_upcoming_length: '2-week' },
  ),
  // Mondays, moved off federal holidays (Martin Luther King Jr. Day)
  businessDays: makeSchedule(
    'businessDays',
    '2017-01-02',
    recur('2016-12-26', {
      frequency: 'weekly',
      skipWeekend: true,
      weekendSolveMode: 'after',
      businessCalendarId: 'federal',
    }),
    { custom_upcoming_length: '1-month' },
  ),
  relative: makeSchedule(
    'relative',
    '2017-01-04',
    {
      relativeTo: {
        scheduleId: 'weekly',
        offset: 2,
        unit: 'business-days',
        direction: 'before',
      },
    },
    { custom_upcoming_length: '1-month' },
  ),
  ending: makeSchedule(
    'ending',
    '2017-01-01',
    recur('2017-01-01', { endMode: 'after_n_occurrences', endOccurrences: 3 }),
  ),
  // The first date of a paid schedule is dropped
  paid: makeSchedule('paid', '2017-01-01', recur('2017-01-01')),
  oneOff: makeSchedule('oneOff', '2017-01-05', '2017-01-05'),
};
const statuses: ScheduleStatuses = new Map(
  Object.values(SCHEDULES).map(s => [
    s.id,
    s.id === 'paid' ? 'paid' : 'upcoming',
  ]),
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2017, 0, 1));
  setBusinessCalendars([
    {
      id: 'federal',
      name: 'U.S. Federal Holidays',
      ...businessCalendarPresets[0].calendar,
    },
  ]);
  setScheduleDates(Object.values(SCHEDULES).map(s => [s.id, s._date]));
});

afterEach(() => {
  vi.useRealTimers();
  setBusinessCalendars([]);
  setScheduleDates([]);
});

describe('schedulePreviewDates', () => {
  it('keeps the web preview output: dedupe, skip forward, paid drop and the final sort', async () => {
    const previews = computeSchedulePreviewTransactions(
      Object.values(SCHEDULES),
      statuses,
      '7',
    );
    await expect(JSON.stringify(previews, null, 2) + '\n').toMatchFileSnapshot(
      './__snapshots__/schedule-preview-dates.json',
    );
  });

  it.each(Object.keys(SCHEDULES))(
    'yields the web preview dates for %s, in order',
    name => {
      const schedule = SCHEDULES[name as keyof typeof SCHEDULES];
      const web = computeSchedulePreviewTransactions(
        [schedule],
        statuses,
        '7',
      ).map(t => t.date);
      const dates = [
        ...schedulePreviewDates(schedule, statuses.get(schedule.id), '7'),
      ];
      expect([...dates].sort().reverse()).toEqual(web);
      expect(dates).toEqual([...dates].sort());
    },
  );

  it('is lazy: two dates of a 366-day window cost one or two getNextDate calls', () => {
    const schedule = makeSchedule('long', '2017-01-01', recur('2017-01-01'), {
      custom_upcoming_length: '366-day',
    });
    const nextDate = vi.fn(getNextDate);
    const dates = schedulePreviewDates(schedule, 'upcoming', '7', nextDate);
    expect(dates.next().value).toBe('2017-01-01');
    expect(dates.next().value).toBe('2017-01-02');
    // An eager drain makes about 366
    expect(nextDate.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(nextDate.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('never yields a date twice when weekend moves repeat one', () => {
    const dates = [
      ...schedulePreviewDates(SCHEDULES.weekends, 'upcoming', '7'),
    ];
    // Saturday 7 and Sunday 8 January both move back to Friday 6
    expect(dates.filter(date => date === '2017-01-06')).toEqual(['2017-01-06']);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('throws instead of looping when the dates stop moving forward', () => {
    // A fresh, earlier date each call: the day never passes the window's end
    let back = 0;
    const backwards = () => {
      back++;
      return `2016-${String(12 - Math.floor(back / 28)).padStart(2, '0')}-${String(28 - (back % 28)).padStart(2, '0')}`;
    };
    const dates = schedulePreviewDates(
      SCHEDULES.daily,
      'upcoming',
      '7',
      backwards,
    );
    expect(() => [...dates]).toThrow(/schedulePreviewDates: no progress/);
    expect(back).toBeLessThan(100);
  });
});
