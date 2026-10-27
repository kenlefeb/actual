import { useMemo } from 'react';

import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';

import { useBusinessCalendars } from './useBusinessCalendars';

/**
 * Fills the shared lookup used by schedule date math and descriptions, and
 * returns the calendars so callers re-run that math when calendars change.
 */
export function useBusinessCalendarLookup() {
  const { data: calendars = [] } = useBusinessCalendars();
  // Synchronous on purpose: callers compute dates in the same render
  useMemo(() => setBusinessCalendars(calendars), [calendars]);
  return calendars;
}
