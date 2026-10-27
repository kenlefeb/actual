import * as d from 'date-fns';

import type {
  BusinessCalendarEntity,
  BusinessCalendarHoliday,
  HolidayRule,
} from '#types/models';

import * as monthUtils from './months';

const MAX_SEARCH_DAYS = 366;

function weekdayOf(date: string) {
  return d.getDay(monthUtils.parseDate(date));
}

function isNonWorkingWeekday(calendar: BusinessCalendarEntity, date: string) {
  const days: readonly number[] = calendar.nonWorkingDays;
  return days.includes(weekdayOf(date));
}

function ruleDate(rule: HolidayRule, year: number): string | null {
  const first = new Date(year, rule.month - 1, 1);
  let day: number;
  switch (rule.kind) {
    case 'fixed':
      day = rule.day;
      break;
    case 'nth-weekday':
      day = 1 + ((rule.weekday - first.getDay() + 7) % 7) + 7 * (rule.nth - 1);
      break;
    case 'last-weekday': {
      const last = d.lastDayOfMonth(first);
      day = last.getDate() - ((last.getDay() - rule.weekday + 7) % 7);
      break;
    }
    default:
      // Unknown rule kinds from newer clients are ignored, not fatal
      return null;
  }
  const date = new Date(year, rule.month - 1, day);
  return date.getMonth() === rule.month - 1
    ? monthUtils.dayFromDate(date)
    : null;
}

function shiftToWorkingWeekday(
  calendar: BusinessCalendarEntity,
  date: string,
  step: 1 | -1,
) {
  let shifted = date;
  for (let i = 0; i < 7 && isNonWorkingWeekday(calendar, shifted); i++) {
    shifted = monthUtils.addDays(shifted, step);
  }
  return shifted;
}

function observedDate(
  calendar: BusinessCalendarEntity,
  rule: HolidayRule,
  date: string,
) {
  if (!isNonWorkingWeekday(calendar, date)) {
    return date;
  }
  const weekday = weekdayOf(date);
  if (weekday === 0 && rule.observance !== 'none') {
    return shiftToWorkingWeekday(calendar, date, 1);
  }
  if (weekday === 6 && rule.observance === 'nearest-weekday') {
    return shiftToWorkingWeekday(calendar, date, -1);
  }
  return date;
}

/**
 * Non-business days in `year` other than regular non-working weekdays:
 * observed holidays plus exceptions marking a date as non-business.
 */
export function getHolidays(
  calendar: BusinessCalendarEntity,
  year: number,
): BusinessCalendarHoliday[] {
  const prefix = `${year}-`;
  const overrides = new Map(calendar.exceptions.map(e => [e.date, e]));
  const holidays: BusinessCalendarHoliday[] = [];

  // Neighbouring years catch observed dates that spill across January 1
  for (const ruleYear of [year - 1, year, year + 1]) {
    for (const rule of calendar.holidays) {
      const date = ruleDate(rule, ruleYear);
      if (date == null) {
        continue;
      }
      const observed = observedDate(calendar, rule, date);
      if (
        observed.startsWith(prefix) &&
        !isNonWorkingWeekday(calendar, observed) &&
        !overrides.has(observed)
      ) {
        holidays.push({ date: observed, name: rule.name });
      }
    }
  }

  for (const exception of calendar.exceptions) {
    if (!exception.isBusinessDay && exception.date.startsWith(prefix)) {
      holidays.push({ date: exception.date, name: exception.name });
    }
  }

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

export function isBusinessDay(calendar: BusinessCalendarEntity, date: string) {
  const exception = calendar.exceptions.find(e => e.date === date);
  if (exception) {
    return exception.isBusinessDay;
  }
  if (isNonWorkingWeekday(calendar, date)) {
    return false;
  }
  const year = Number(date.slice(0, 4));
  return !getHolidays(calendar, year).some(holiday => holiday.date === date);
}

export function getNearestBusinessDay(
  calendar: BusinessCalendarEntity,
  date: string,
  direction: 'before' | 'after',
): string {
  const step = direction === 'before' ? -1 : 1;
  let candidate = date;
  for (let i = 0; i <= MAX_SEARCH_DAYS; i++) {
    if (isBusinessDay(calendar, candidate)) {
      return candidate;
    }
    candidate = monthUtils.addDays(candidate, step);
  }
  throw new Error(
    `No business day within ${MAX_SEARCH_DAYS} days ${direction} ${date}`,
  );
}
