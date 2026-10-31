import type { RecurConfig, RelativeDateConfig } from '#types/models';

import { setBusinessCalendars } from './business-calendar-lookup';
import { businessCalendarPresets } from './business-calendar-presets';
import * as monthUtils from './months';
import { getRelativeOccurrences } from './relative-dates';
import { setScheduleDates } from './schedule-date-lookup';
import { getNextDate } from './schedules';

const federal = {
  id: 'federal',
  name: 'U.S. Federal Holidays',
  ...businessCalendarPresets[0].calendar,
};

// Monthly on the 15th, moved before non-business days
const payday: RecurConfig = {
  start: '2026-01-15',
  frequency: 'monthly',
  skipWeekend: true,
  weekendSolveMode: 'before',
  businessCalendarId: 'federal',
};

const deposit: RelativeDateConfig = {
  relativeTo: {
    scheduleId: 'payday',
    offset: 2,
    unit: 'business-days',
    direction: 'before',
  },
  businessCalendarId: 'federal',
};

const between = (config: RelativeDateConfig, from: string, to: string) =>
  getRelativeOccurrences(
    config,
    monthUtils.parseDate(from),
    monthUtils.parseDate(to),
  );

describe('relative dates', () => {
  beforeEach(() => {
    setBusinessCalendars([federal]);
    setScheduleDates([['payday', payday]]);
  });

  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
  });

  it('treats an invalid synced offset as zero instead of hanging', () => {
    const huge = {
      ...deposit,
      relativeTo: { ...deposit.relativeTo, offset: 1_000_000_000 },
    };
    // Zero business days before Thu Oct 15 is Oct 15 itself
    expect(between(huge, '2026-10-01', '2026-10-31')).toEqual(['2026-10-15']);
  });

  it('counts business days before the moved source date', () => {
    // Payday Thu Oct 15 -> Tue Oct 13; payday Sun Nov 15 moves to Fri Nov 13,
    // and Wed Nov 11 is Veterans Day -> Tue Nov 10
    expect(between(deposit, '2026-10-01', '2026-11-30')).toEqual([
      '2026-10-13',
      '2026-11-10',
    ]);
  });

  it('counts calendar days, then moves off non-business days', () => {
    setScheduleDates([
      ['statement', { start: '2026-01-05', frequency: 'monthly' }],
    ]);
    const cardPayment: RelativeDateConfig = {
      relativeTo: {
        scheduleId: 'statement',
        offset: 21,
        unit: 'days',
        direction: 'after',
      },
      businessCalendarId: 'federal',
      skipWeekend: true,
      weekendSolveMode: 'after',
    };
    // Dec 5 + 21 days = Sat Dec 26 -> Mon Dec 28
    expect(between(cardPayment, '2026-12-01', '2026-12-31')).toEqual([
      '2026-12-28',
    ]);
  });

  it('skips only weekends when no calendar is chosen', () => {
    const { businessCalendarId: _omit, ...weekendsOnly } = deposit;
    // Payday still moves to Fri Nov 13 (its own calendar); counting back two
    // weekdays without holidays lands on Wed Nov 11
    expect(between(weekendsOnly, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-11',
    ]);
  });

  it('skips only weekends when its calendar has been deleted', () => {
    // Paycheck deposits count business days in the account's calendar; a
    // deleted calendar counts like no calendar at all
    const deleted = { ...deposit, businessCalendarId: 'deleted' };
    expect(between(deleted, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-11',
    ]);
  });

  it('treats a zero offset as the nearest business day', () => {
    const sameDay: RelativeDateConfig = {
      ...deposit,
      relativeTo: { ...deposit.relativeTo, offset: 0 },
    };
    expect(between(sameDay, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-13',
    ]);
  });

  it('has no occurrences when the source is missing', () => {
    setScheduleDates([]);
    expect(between(deposit, '2026-10-01', '2026-11-30')).toEqual([]);
  });

  it('has no occurrences when the source is itself relative', () => {
    setScheduleDates([
      ['payday', payday],
      ['deposit', deposit],
    ]);
    const chained: RelativeDateConfig = {
      ...deposit,
      relativeTo: { ...deposit.relativeTo, scheduleId: 'deposit' },
    };
    expect(between(chained, '2026-10-01', '2026-11-30')).toEqual([]);
  });

  it('supports a one-time source date', () => {
    setScheduleDates([['bonus', '2026-12-18']]);
    const bonusDeposit: RelativeDateConfig = {
      ...deposit,
      relativeTo: { ...deposit.relativeTo, scheduleId: 'bonus' },
    };
    expect(between(bonusDeposit, '2026-12-01', '2026-12-31')).toEqual([
      '2026-12-16',
    ]);
  });

  it('gives the next date of a relative schedule', () => {
    expect(
      getNextDate(
        { op: 'isapprox', field: 'date', value: deposit },
        new Date(2026, 10, 1),
      ),
    ).toBe('2026-11-10');
  });

  it('finds the next date when recent source dates map before today', () => {
    // Weekly Mondays from Oct 5, 2026; asked on Fri Nov 13, the Mondays
    // searched first map to Thursdays already past, the next is Thu Nov 19
    setScheduleDates([
      ['weekly', { start: '2026-10-05', frequency: 'weekly' }],
    ]);
    const beforeWeekly: RelativeDateConfig = {
      relativeTo: { ...deposit.relativeTo, scheduleId: 'weekly' },
    };
    expect(
      getNextDate(
        { op: 'isapprox', field: 'date', value: beforeWeekly },
        new Date(2026, 10, 13),
      ),
    ).toBe('2026-11-19');
  });
});
