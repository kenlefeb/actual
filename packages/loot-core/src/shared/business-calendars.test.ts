import type { BusinessCalendarEntity, HolidayRule } from '#types/models';

import {
  getHolidays,
  getNearestBusinessDay,
  getWesternEaster,
  isBusinessDay,
} from './business-calendars';

function calendar(
  overrides: Partial<BusinessCalendarEntity> = {},
): BusinessCalendarEntity {
  return {
    id: 'calendar',
    name: 'Test',
    nonWorkingDays: [0, 6],
    holidays: [],
    exceptions: [],
    ...overrides,
  };
}

const july4 = (observance: HolidayRule['observance']): HolidayRule => ({
  id: 'july-4',
  name: 'Independence Day',
  kind: 'fixed',
  month: 7,
  day: 4,
  observance,
});

describe('business calendars', () => {
  test('Saturday and Sunday are non-business days by default', () => {
    const cal = calendar();
    expect(isBusinessDay(cal, '2026-07-11')).toBe(false);
    expect(isBusinessDay(cal, '2026-07-12')).toBe(false);
    expect(isBusinessDay(cal, '2026-07-13')).toBe(true);
  });

  test('fixed-date rules repeat every year', () => {
    const cal = calendar({ holidays: [july4('none')] });
    expect(isBusinessDay(cal, '2025-07-04')).toBe(false);
    expect(isBusinessDay(cal, '2029-07-04')).toBe(false);
  });

  test('nth-weekday rules', () => {
    const cal = calendar({
      holidays: [
        {
          id: 'thanksgiving',
          name: 'Thanksgiving Day',
          kind: 'nth-weekday',
          month: 11,
          weekday: 4,
          nth: 4,
          observance: 'none',
        },
      ],
    });
    expect(getHolidays(cal, 2026)).toEqual([
      { date: '2026-11-26', name: 'Thanksgiving Day' },
    ]);
    expect(getHolidays(cal, 2027)).toEqual([
      { date: '2027-11-25', name: 'Thanksgiving Day' },
    ]);
  });

  test('last-weekday rules', () => {
    const cal = calendar({
      holidays: [
        {
          id: 'memorial',
          name: 'Memorial Day',
          kind: 'last-weekday',
          month: 5,
          weekday: 1,
          observance: 'none',
        },
      ],
    });
    expect(getHolidays(cal, 2026)).toEqual([
      { date: '2026-05-25', name: 'Memorial Day' },
    ]);
  });

  test.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2038, '2038-04-25'],
    [1818, '1818-03-22'],
    [2285, '2285-03-22'],
  ])('Western Easter Sunday in %i is %s', (year, date) => {
    expect(getWesternEaster(year)).toBe(date);
  });

  test('easter rules count days from Easter Sunday', () => {
    const cal = calendar({
      holidays: [
        {
          id: 'good-friday',
          name: 'Good Friday',
          kind: 'easter',
          offset: -2,
          observance: 'none',
        },
        {
          id: 'easter-monday',
          name: 'Easter Monday',
          kind: 'easter',
          offset: 1,
          observance: 'none',
        },
      ],
    });
    expect(getHolidays(cal, 2026)).toEqual([
      { date: '2026-04-03', name: 'Good Friday' },
      { date: '2026-04-06', name: 'Easter Monday' },
    ]);
    expect(isBusinessDay(cal, '2027-03-26')).toBe(false);
  });

  test('easter rules follow observance like other rules', () => {
    const easter = (observance: HolidayRule['observance']) =>
      calendar({
        holidays: [
          {
            id: 'easter',
            name: 'Easter',
            kind: 'easter',
            offset: 0,
            observance,
          },
        ],
      });
    expect(getHolidays(easter('nearest-weekday'), 2026)).toEqual([
      { date: '2026-04-06', name: 'Easter' },
    ]);
    expect(getHolidays(easter('none'), 2026)).toEqual([]);
  });

  test('nearest-weekday observance moves Saturday to Friday', () => {
    const cal = calendar({ holidays: [july4('nearest-weekday')] });
    expect(getHolidays(cal, 2026)).toEqual([
      { date: '2026-07-03', name: 'Independence Day' },
    ]);
    // Sunday moves to Monday
    expect(getHolidays(cal, 2027)).toEqual([
      { date: '2027-07-05', name: 'Independence Day' },
    ]);
  });

  test('sunday-to-monday observance leaves Saturday holidays alone', () => {
    const cal = calendar({ holidays: [july4('sunday-to-monday')] });
    expect(getHolidays(cal, 2026)).toEqual([]);
    expect(getHolidays(cal, 2027)).toEqual([
      { date: '2027-07-05', name: 'Independence Day' },
    ]);
  });

  test('no observance never shifts', () => {
    const cal = calendar({ holidays: [july4('none')] });
    expect(getHolidays(cal, 2027)).toEqual([]);
    expect(isBusinessDay(cal, '2027-07-05')).toBe(true);
  });

  test('observed dates can cross a year boundary', () => {
    const cal = calendar({
      holidays: [
        {
          id: 'new-year',
          name: "New Year's Day",
          kind: 'fixed',
          month: 1,
          day: 1,
          observance: 'nearest-weekday',
        },
      ],
    });
    expect(getHolidays(cal, 2027)).toEqual([
      { date: '2027-01-01', name: "New Year's Day" },
      { date: '2027-12-31', name: "New Year's Day" },
    ]);
    expect(getHolidays(cal, 2028)).toEqual([]);
    expect(isBusinessDay(cal, '2027-12-31')).toBe(false);
  });

  test('exceptions add one-off closures for one year only', () => {
    const cal = calendar({
      exceptions: [
        { date: '2026-12-26', isBusinessDay: false, name: 'Company closure' },
      ],
    });
    expect(isBusinessDay(cal, '2026-12-28')).toBe(true);
    expect(getHolidays(cal, 2026)).toEqual([
      { date: '2026-12-26', name: 'Company closure' },
    ]);
    expect(getHolidays(cal, 2027)).toEqual([]);
  });

  test('exceptions can make a holiday or weekend a business day', () => {
    const cal = calendar({
      holidays: [july4('nearest-weekday')],
      exceptions: [
        { date: '2026-07-03', isBusinessDay: true, name: 'Open' },
        { date: '2026-07-11', isBusinessDay: true, name: 'Saturday shift' },
      ],
    });
    expect(isBusinessDay(cal, '2026-07-03')).toBe(true);
    expect(isBusinessDay(cal, '2026-07-11')).toBe(true);
    expect(getHolidays(cal, 2026)).toEqual([]);
  });

  test('custom non-working weekdays', () => {
    const cal = calendar({ nonWorkingDays: [5, 6] });
    expect(isBusinessDay(cal, '2026-07-10')).toBe(false);
    expect(isBusinessDay(cal, '2026-07-12')).toBe(true);
  });

  test('nearest business day on or before and on or after', () => {
    const cal = calendar({ holidays: [july4('nearest-weekday')] });
    expect(getNearestBusinessDay(cal, '2026-07-04', 'before')).toBe(
      '2026-07-02',
    );
    expect(getNearestBusinessDay(cal, '2026-07-04', 'after')).toBe(
      '2026-07-06',
    );
    expect(getNearestBusinessDay(cal, '2026-07-06', 'after')).toBe(
      '2026-07-06',
    );
  });

  test('nearest business day search is bounded', () => {
    const cal = calendar({
      exceptions: Array.from({ length: 400 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
        isBusinessDay: false,
        name: 'Closed',
      })),
    });
    expect(() => getNearestBusinessDay(cal, '2026-01-01', 'after')).toThrow(
      'No business day within 366 days',
    );
  });

  test('holidays are computed once per calendar object and year', () => {
    let reads = 0;
    const base = calendar({ holidays: [july4('none')] });
    const counted = {
      ...base,
      get holidays() {
        reads++;
        return base.holidays;
      },
    } as BusinessCalendarEntity;

    isBusinessDay(counted, '2026-07-06');
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);
    isBusinessDay(counted, '2026-07-07');
    isBusinessDay(counted, '2026-07-08');
    expect(reads).toBe(afterFirst);

    isBusinessDay(counted, '2027-07-06');
    expect(reads).toBeGreaterThan(afterFirst);
  });

  test('a modified copy of a calendar gets fresh results', () => {
    const cal = calendar({ holidays: [july4('none')] });
    expect(isBusinessDay(cal, '2026-07-06')).toBe(true);
    expect(isBusinessDay(cal, '2026-07-04')).toBe(false);

    const withHoliday = {
      ...cal,
      holidays: [...cal.holidays, { ...july4('none'), id: 'x', day: 6 }],
    };
    expect(isBusinessDay(withHoliday, '2026-07-06')).toBe(false);
    expect(isBusinessDay(cal, '2026-07-06')).toBe(true);

    const withException = {
      ...withHoliday,
      exceptions: [{ date: '2026-07-06', isBusinessDay: true, name: 'Open' }],
    };
    expect(isBusinessDay(withException, '2026-07-06')).toBe(true);
  });
});
