import { useQuery } from '@tanstack/react-query';

import { paycheckQueries } from '#paychecks';

export function usePaychecks() {
  return useQuery(paycheckQueries.list());
}
