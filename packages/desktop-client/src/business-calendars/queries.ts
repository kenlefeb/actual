import { send } from '@actual-app/core/platform/client/connection';
import type { BusinessCalendarEntity } from '@actual-app/core/types/models';
import { queryOptions } from '@tanstack/react-query';

export const businessCalendarQueries = {
  all: () => ['business-calendars'],
  lists: () => [...businessCalendarQueries.all(), 'lists'],
  list: () =>
    queryOptions<BusinessCalendarEntity[]>({
      queryKey: [...businessCalendarQueries.lists()],
      queryFn: () => send('business-calendars-get'),
      placeholderData: [],
      staleTime: Infinity,
    }),
};
