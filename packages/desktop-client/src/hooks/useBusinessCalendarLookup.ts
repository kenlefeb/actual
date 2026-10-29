import type { BusinessCalendarEntity } from '@actual-app/core/types/models';

import { useBusinessCalendars } from './useBusinessCalendars';

// A stable empty list while loading, so callers don't recompute every render
const NO_CALENDARS: BusinessCalendarEntity[] = [];

/**
 * The business calendars, for the shared lookup used by schedule date math
 * and descriptions. Callers pass them to `withScheduleLookups` around the math
 * that reads the lookup; filling it here would be a memo with an unused
 * result, which the React Compiler drops (sc-811).
 */
export function useBusinessCalendarLookup() {
  return useBusinessCalendars().data ?? NO_CALENDARS;
}
