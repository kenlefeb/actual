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
import { queryOptions, useQuery } from '@tanstack/react-query';

import { aqlQuery } from '#queries/aqlQuery';

const NO_SCHEDULES: ScheduleEntity[] = [];

// Tables the schedules view reads; a change to any of them refetches it
export const SCHEDULE_TABLES = [
  'schedules',
  'schedules_next_date',
  'schedules_json_paths',
  'rules',
  'payee_mapping',
];

/** One shared query of every schedule, refetched by sync events. */
export const scheduleDateLookupQueries = {
  all: () => ['schedule-date-lookup'],
  list: () =>
    queryOptions<ScheduleEntity[]>({
      queryKey: [...scheduleDateLookupQueries.all(), 'list'],
      queryFn: async () => (await aqlQuery(q('schedules').select('*'))).data,
      staleTime: Infinity,
    }),
};

/**
 * Every schedule (with its loading state), for the shared lookup of each
 * schedule's date (and name) used by relative dates. Callers pass them to
 * `withScheduleLookups` around the date math that reads the lookup. Reads all
 * schedules, because a relative schedule's source is often filtered out of an
 * account's schedule list.
 */
export function useScheduleDateLookup() {
  // Every caller shares this one query (sc-915)
  const { data, isPending } = useQuery(scheduleDateLookupQueries.list());
  // A stable empty list while loading, so callers don't recompute every render
  const schedules = data ?? NO_SCHEDULES;
  const isLoading = isPending;
  // Filling the lookup here would be a memo with an unused result, which the
  // React Compiler drops (sc-811)
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
