// 0 = Sunday ... 6 = Saturday, matching Date.getDay()
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type HolidayObservance = 'none' | 'sunday-to-monday' | 'nearest-weekday';

type HolidayRuleBase = {
  id: string;
  name: string;
  observance: HolidayObservance;
};

type MonthRuleBase = HolidayRuleBase & {
  // 1 = January ... 12 = December
  month: number;
};

export type HolidayRule =
  | (MonthRuleBase & { kind: 'fixed'; day: number })
  | (MonthRuleBase & {
      kind: 'nth-weekday';
      weekday: Weekday;
      nth: 1 | 2 | 3 | 4;
    })
  | (MonthRuleBase & { kind: 'last-weekday'; weekday: Weekday })
  // Days from Western (Gregorian) Easter Sunday, -100 to 100: Good Friday is -2
  | (HolidayRuleBase & { kind: 'easter'; offset: number });

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
