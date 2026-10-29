import { useMemo } from 'react';

import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';
import { q } from '@actual-app/core/shared/query';
import {
  setScheduleDates,
  setScheduleNames,
} from '@actual-app/core/shared/schedule-date-lookup';
import type {
  BusinessCalendarEntity,
  ScheduleEntity,
} from '@actual-app/core/types/models';

import { useQuery } from './useQuery';

const NO_SCHEDULES: ScheduleEntity[] = [];

/**
 * Fills the shared lookup of every schedule's date (and name) used by
 * relative dates, and returns the schedules (with their loading state) so
 * callers re-run date math when they change. Reads all schedules, because a relative schedule's source is
 * often filtered out of an account's schedule list.
 */
export function useScheduleDateLookup() {
  const { data, isLoading } = useQuery<ScheduleEntity>(
    () => q('schedules').select('*'),
    [],
  );
  // A stable empty list while loading, so callers don't recompute every render
  const schedules = data ?? NO_SCHEDULES;
  // Synchronous on purpose: callers compute dates in the same render
  useMemo(() => applyScheduleDateLookup(schedules), [schedules]);
  return { schedules, isLoading };
}

/** Fills the shared lookup from `schedules`. */
export function applyScheduleDateLookup(schedules: readonly ScheduleEntity[]) {
  setScheduleDates(schedules.map(s => [s.id, s._date] as const));
  setScheduleNames(
    schedules.flatMap(s => (s.name ? [[s.id, s.name] as const] : [])),
  );
}

/**
 * Runs `compute`, date math that reads the shared lookups, after filling them
 * from what this render sees. Passing them in makes them inputs of the
 * caller's memo: the React Compiler can't see reads through module state, so
 * it would otherwise memoize the math without them and keep stale dates.
 */
export function withScheduleLookups<T>(
  {
    calendars,
    schedules,
  }: {
    calendars?: BusinessCalendarEntity[];
    schedules?: readonly ScheduleEntity[];
  },
  compute: () => T,
): T {
  if (calendars) {
    setBusinessCalendars(calendars);
  }
  if (schedules) {
    applyScheduleDateLookup(schedules);
  }
  return compute();
}
