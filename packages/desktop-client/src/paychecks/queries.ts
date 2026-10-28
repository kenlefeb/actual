import { send } from '@actual-app/core/platform/client/connection';
import type { PaycheckEntity } from '@actual-app/core/types/models';
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
};
