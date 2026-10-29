import { send } from '@actual-app/core/platform/client/connection';
import type {
  PaycheckEntity,
  PaycheckYearToDate,
} from '@actual-app/core/types/models';
import { queryOptions } from '@tanstack/react-query';

export const paycheckQueries = {
  all: () => ['paychecks'],
  lists: () => [...paycheckQueries.all(), 'lists'],
  list: () =>
    queryOptions<PaycheckEntity[]>({
      queryKey: [...paycheckQueries.lists()],
      queryFn: () => send('paychecks-get'),
      placeholderData: [],
      staleTime: Infinity,
    }),
  // Refetched each time the editor opens: posted transactions change outside it
  yearToDate: (id: PaycheckEntity['id']) =>
    queryOptions<PaycheckYearToDate[]>({
      queryKey: [...paycheckQueries.all(), 'year-to-date', id],
      queryFn: () => send('paycheck-year-to-date', { id }),
    }),
};
