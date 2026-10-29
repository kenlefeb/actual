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

// Keeps occurrence windows and business-day walks bounded, even for synced data
export const MAX_RELATIVE_OFFSET = 366;

export function isValidRelativeOffset(offset: unknown): offset is number {
  return (
    Number.isInteger(offset) &&
    (offset as number) >= 0 &&
    (offset as number) <= MAX_RELATIVE_OFFSET
  );
}

function getOffset(config: RelativeDateConfig) {
  const { offset } = config.relativeTo;
  return isValidRelativeOffset(offset) ? offset : 0;
}

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

// Lookup entries keep their identity until the next refresh, so rule checks
// over many transactions parse each source once
const parsedSources = new WeakMap<
  RecurConfig,
  ParsedRecur['schedule'] | null
>();

function parseSource(source: RecurConfig) {
  if (!parsedSources.has(source)) {
    const value: { type: string } = new Condition(
      'isapprox',
      'date',
      source,
      null,
    ).getValue();
    parsedSources.set(
      source,
      value.type === 'recur' ? (value as ParsedRecur).schedule : null,
    );
  }
  return parsedSources.get(source) ?? null;
}

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
  const schedule = parseSource(source);
  if (!schedule) {
    return [];
  }
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
  const { unit, direction } = config.relativeTo;
  const offset = getOffset(config);
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
  // Bounded so a calendar without business days cannot loop forever
  for (let i = 0, counted = 0; counted < offset; i++) {
    if (i > offset * 7 + 366) {
      throw new Error(`No ${offset} business days ${direction} ${day}`);
    }
    current = monthUtils.addDays(current, step);
    if (isBusinessDay(calendar, current)) {
      counted++;
    }
  }
  return current;
}

// The relative day for one source occurrence (already moved by the source)
export function toRelativeDay(sourceDay: string, config: RelativeDateConfig) {
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
  const pad = getOffset(config) * 2 + 14;
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
  // Search a year from the first source occurrence that can still land on or
  // after `start`: a daily or weekly source can map several occurrences to
  // before `start`, and a source may not begin for years
  const pad = getOffset(config) * 2 + 14;
  const [first] = sourceOccurrences(source, {
    start: d.subDays(start, pad),
    take: 1,
  });
  if (first) {
    const from = d.max([start, d.subDays(monthUtils.parseDate(first), pad)]);
    const [next] = getRelativeOccurrences(
      config,
      from,
      d.addDays(from, 366 + pad),
    );
    if (next) {
      return next;
    }
  }
  const [last] = sourceOccurrences(source, { reverse: true, take: 1 }).map(
    day => toRelativeDay(day, config),
  );
  return last ?? null;
}
