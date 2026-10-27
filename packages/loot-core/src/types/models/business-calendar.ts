// 0 = Sunday ... 6 = Saturday, matching Date.getDay()
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type HolidayObservance = 'none' | 'sunday-to-monday' | 'nearest-weekday';

type HolidayRuleBase = {
  id: string;
  name: string;
  // 1 = January ... 12 = December
  month: number;
  observance: HolidayObservance;
};

export type HolidayRule =
  | (HolidayRuleBase & { kind: 'fixed'; day: number })
  | (HolidayRuleBase & {
      kind: 'nth-weekday';
      weekday: Weekday;
      nth: 1 | 2 | 3 | 4;
    })
  | (HolidayRuleBase & { kind: 'last-weekday'; weekday: Weekday });

export type BusinessCalendarException = {
  // YYYY-MM-DD
  date: string;
  isBusinessDay: boolean;
  name: string;
};

export type BusinessCalendarEntity = {
  id: string;
  name: string;
  nonWorkingDays: Weekday[];
  holidays: HolidayRule[];
  exceptions: BusinessCalendarException[];
};

export type BusinessCalendarHoliday = {
  // Observed YYYY-MM-DD date that is not a business day
  date: string;
  name: string;
};
