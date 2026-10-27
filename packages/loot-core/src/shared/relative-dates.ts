import * as d from 'date-fns';

import { Condition } from '#server/rules';
import type {
  BusinessCalendarEntity,
  RecurConfig,
  RelativeDateConfig,
  ScheduleEntity,
} from '#types/models';

import { getBusinessCalendar } from './business-calendar-lookup';
import { getNearestBusinessDay, isBusinessDay } from './business-calendars';
import * as monthUtils from './months';
import { getScheduleDate } from './schedule-date-lookup';
import { getDateWithSkippedWeekend } from './schedules';

const WEEKENDS_ONLY: BusinessCalendarEntity = {
  id: 'weekends',
  name: 'Weekends',
  nonWorkingDays: [0, 6],
  holidays: [],
  exceptions: [],
};

export function isRelativeDate(
  date: ScheduleEntity['_date'] | null | undefined,
): date is RelativeDateConfig {
  return typeof date === 'object' && date !== null && 'relativeTo' in date;
}

type OccurrenceQuery = {
  start?: Date;
  end?: Date;
  take?: number;
  reverse?: boolean;
};

type ParsedRecur = {
  type: 'recur';
  schedule: {
    occurrences: (args: OccurrenceQuery) => {
      toArray: () => Array<{ date: Date }>;
    };
    data: {
      skipWeekend?: boolean;
      weekendSolve?: 'before' | 'after';
      businessCalendarId?: string;
    };
  };
};

function sourceOccurrences(
  source: string | RecurConfig,
  query: OccurrenceQuery,
): string[] {
  if (typeof source === 'string') {
    const day = monthUtils.parseDate(source);
    const inRange =
      (!query.start || day >= query.start) && (!query.end || day <= query.end);
    return query.reverse || inRange ? [source] : [];
  }
  const value: { type: string } = new Condition(
    'isapprox',
    'date',
    source,
    null,
  ).getValue();
  if (value.type !== 'recur') {
    return [];
  }
  const { schedule } = value as ParsedRecur;
  return schedule
    .occurrences(query)
    .toArray()
    .map(({ date }) =>
      monthUtils.dayFromDate(
        schedule.data.skipWeekend
          ? getDateWithSkippedWeekend(
              date,
              schedule.data.weekendSolve ?? 'after',
              schedule.data.businessCalendarId,
            )
          : date,
      ),
    );
}

function applyOffset(day: string, config: RelativeDateConfig): string {
  const { offset, unit, direction } = config.relativeTo;
  const step = direction === 'before' ? -1 : 1;
  if (unit === 'days') {
    return monthUtils.addDays(day, step * offset);
  }
  const calendar =
    getBusinessCalendar(config.businessCalendarId) ?? WEEKENDS_ONLY;
  if (offset === 0) {
    return getNearestBusinessDay(calendar, day, direction);
  }
  let current = day;
  for (let counted = 0; counted < offset;) {
    current = monthUtils.addDays(current, step);
    if (isBusinessDay(calendar, current)) {
      counted++;
    }
  }
  return current;
}

function toRelativeDay(sourceDay: string, config: RelativeDateConfig) {
  const day = applyOffset(sourceDay, config);
  return config.skipWeekend
    ? monthUtils.dayFromDate(
        getDateWithSkippedWeekend(
          monthUtils.parseDate(day),
          config.weekendSolveMode ?? 'after',
          config.businessCalendarId,
        ),
      )
    : day;
}

/**
 * Occurrences of a relative schedule between `from` and `to` (inclusive):
 * each source occurrence after the source's own move, offset, then moved off
 * non-business days if the relative schedule asks for it. A missing or
 * relative source produces none.
 */
export function getRelativeOccurrences(
  config: RelativeDateConfig,
  from: Date,
  to: Date,
): string[] {
  const source = getScheduleDate(config.relativeTo.scheduleId);
  if (source == null || isRelativeDate(source)) {
    return [];
  }
  // Wide enough for the offset (business days can span weekends and
  // holidays) plus moves of either schedule
  const pad = config.relativeTo.offset * 2 + 14;
  const first = monthUtils.dayFromDate(from);
  const last = monthUtils.dayFromDate(to);
  const days = sourceOccurrences(source, {
    start: d.subDays(from, pad),
    end: d.addDays(to, pad),
  })
    .map(day => toRelativeDay(day, config))
    .filter(day => day >= first && day <= last);
  return [...new Set(days)].sort();
}

/**
 * The first relative occurrence on or after `start`, or the last one if the
 * source has ended, like repeating dates. Null for a missing or relative
 * source.
 */
export function getNextRelativeDate(
  config: RelativeDateConfig,
  start: Date,
): string | null {
  const source = getScheduleDate(config.relativeTo.scheduleId);
  if (source == null || isRelativeDate(source)) {
    return null;
  }
  const pad = config.relativeTo.offset * 2 + 14;
  const startDay = monthUtils.dayFromDate(start);
  // A few source occurrences from just before `start` cover offsets that
  // move a later source occurrence back across `start`
  const ahead = sourceOccurrences(source, {
    start: d.subDays(start, pad),
    take: 4,
  })
    .map(day => toRelativeDay(day, config))
    .filter(day => day >= startDay)
    .sort();
  if (ahead.length > 0) {
    return ahead[0];
  }
  const [last] = sourceOccurrences(source, { reverse: true, take: 1 }).map(
    day => toRelativeDay(day, config),
  );
  return last ?? null;
}
