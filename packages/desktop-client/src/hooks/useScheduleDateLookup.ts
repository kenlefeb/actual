import { useMemo } from 'react';

import { q } from '@actual-app/core/shared/query';
import {
  setScheduleDates,
  setScheduleNames,
} from '@actual-app/core/shared/schedule-date-lookup';
import type { ScheduleEntity } from '@actual-app/core/types/models';

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

/**
 * Fills the shared lookup from `schedules`. Callers that memoize date math
 * call it inside the memo too, so the math depends on the schedules it reads.
 */
export function applyScheduleDateLookup(schedules: readonly ScheduleEntity[]) {
  setScheduleDates(schedules.map(s => [s.id, s._date] as const));
  setScheduleNames(
    schedules.flatMap(s => (s.name ? [[s.id, s.name] as const] : [])),
  );
}
