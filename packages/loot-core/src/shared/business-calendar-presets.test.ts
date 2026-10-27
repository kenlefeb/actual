import { businessCalendarPresets } from './business-calendar-presets';
import { getHolidays } from './business-calendars';

const preset = businessCalendarPresets.find(
  p => p.id === 'us-federal-holidays',
);
const calendar = { id: 'federal', name: 'Federal', ...preset!.calendar };

describe('U.S. Federal Holidays preset', () => {
  // OPM observed dates: Saturday holidays move to Friday, Sunday to Monday
  test('2026 observed holidays, with July 4 moved to Friday', () => {
    expect(getHolidays(calendar, 2026).map(h => h.date)).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03',
      '2026-09-07',
      '2026-10-12',
      '2026-11-11',
      '2026-11-26',
      '2026-12-25',
    ]);
  });

  test('2027 observed holidays, including New Year 2028 on December 31', () => {
    expect(getHolidays(calendar, 2027).map(h => h.date)).toEqual([
      '2027-01-01',
      '2027-01-18',
      '2027-02-15',
      '2027-05-31',
      '2027-06-18',
      '2027-07-05',
      '2027-09-06',
      '2027-10-11',
      '2027-11-11',
      '2027-11-25',
      '2027-12-24',
      '2027-12-31',
    ]);
  });

  test('contains the eleven federal holidays', () => {
    expect(calendar.holidays).toHaveLength(11);
  });
});

describe('U.S. Federal Reserve preset', () => {
  const fedPreset = businessCalendarPresets.find(
    p => p.id === 'us-federal-reserve',
  );
  const fed = { id: 'fed', name: 'Fed', ...fedPreset!.calendar };

  // Federal Reserve published schedule; Saturday holidays (Jul 4 2026,
  // Jun 19 and Dec 25 2027) are not observed on a weekday
  test('2026 observed holidays', () => {
    expect(getHolidays(fed, 2026).map(h => h.date)).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-05-25',
      '2026-06-19',
      '2026-09-07',
      '2026-10-12',
      '2026-11-11',
      '2026-11-26',
      '2026-12-25',
    ]);
  });

  test('2027 observed holidays, with July 4 moved to Monday', () => {
    expect(getHolidays(fed, 2027).map(h => h.date)).toEqual([
      '2027-01-01',
      '2027-01-18',
      '2027-02-15',
      '2027-05-31',
      '2027-07-05',
      '2027-09-06',
      '2027-10-11',
      '2027-11-11',
      '2027-11-25',
    ]);
  });

  test('does not change the federal holidays preset', () => {
    expect(
      calendar.holidays.every(h => h.observance === 'nearest-weekday'),
    ).toBe(true);
  });
});
