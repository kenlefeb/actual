import type { BusinessCalendarEntity, HolidayRule } from '#types/models';

export type BusinessCalendarPreset = {
  id: string;
  name: string;
  calendar: Omit<BusinessCalendarEntity, 'id' | 'name'>;
};

const nearestWeekday = 'nearest-weekday' as const;

// U.S. federal holidays (5 U.S.C. 6103, OPM): Saturday holidays are observed the
// preceding Friday, Sunday holidays the following Monday. Inauguration Day is
// omitted because it applies only in the Washington, D.C. area.
const usFederalHolidays: HolidayRule[] = [
  {
    id: 'new-years-day',
    name: "New Year's Day",
    kind: 'fixed',
    month: 1,
    day: 1,
    observance: nearestWeekday,
  },
  {
    id: 'martin-luther-king-jr-day',
    name: 'Martin Luther King Jr. Day',
    kind: 'nth-weekday',
    month: 1,
    weekday: 1,
    nth: 3,
    observance: nearestWeekday,
  },
  {
    id: 'washingtons-birthday',
    name: "Washington's Birthday",
    kind: 'nth-weekday',
    month: 2,
    weekday: 1,
    nth: 3,
    observance: nearestWeekday,
  },
  {
    id: 'memorial-day',
    name: 'Memorial Day',
    kind: 'last-weekday',
    month: 5,
    weekday: 1,
    observance: nearestWeekday,
  },
  {
    id: 'juneteenth',
    name: 'Juneteenth National Independence Day',
    kind: 'fixed',
    month: 6,
    day: 19,
    observance: nearestWeekday,
  },
  {
    id: 'independence-day',
    name: 'Independence Day',
    kind: 'fixed',
    month: 7,
    day: 4,
    observance: nearestWeekday,
  },
  {
    id: 'labor-day',
    name: 'Labor Day',
    kind: 'nth-weekday',
    month: 9,
    weekday: 1,
    nth: 1,
    observance: nearestWeekday,
  },
  {
    id: 'columbus-day',
    name: 'Columbus Day',
    kind: 'nth-weekday',
    month: 10,
    weekday: 1,
    nth: 2,
    observance: nearestWeekday,
  },
  {
    id: 'veterans-day',
    name: 'Veterans Day',
    kind: 'fixed',
    month: 11,
    day: 11,
    observance: nearestWeekday,
  },
  {
    id: 'thanksgiving-day',
    name: 'Thanksgiving Day',
    kind: 'nth-weekday',
    month: 11,
    weekday: 4,
    nth: 4,
    observance: nearestWeekday,
  },
  {
    id: 'christmas-day',
    name: 'Christmas Day',
    kind: 'fixed',
    month: 12,
    day: 25,
    observance: nearestWeekday,
  },
];

export const businessCalendarPresets: BusinessCalendarPreset[] = [
  {
    id: 'us-federal-holidays',
    name: 'U.S. Federal Holidays',
    calendar: {
      nonWorkingDays: [0, 6],
      holidays: usFederalHolidays,
      exceptions: [],
    },
  },
  {
    id: 'us-federal-reserve',
    name: 'U.S. Federal Reserve',
    calendar: {
      nonWorkingDays: [0, 6],
      // Same holidays; the Fed observes Sunday holidays on Monday but does not move Saturday ones
      holidays: usFederalHolidays.map(rule => ({
        ...rule,
        observance: 'sunday-to-monday',
      })),
      exceptions: [],
    },
  },
];
