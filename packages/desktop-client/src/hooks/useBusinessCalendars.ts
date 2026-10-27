import { useQuery } from '@tanstack/react-query';

import { businessCalendarQueries } from '#business-calendars';

export function useBusinessCalendars() {
  return useQuery(businessCalendarQueries.list());
}
