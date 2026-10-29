import type {
  AccountEntity,
  PaycheckEntity,
  ScheduleEntity,
} from '@actual-app/core/types/models';

import { usePaychecks } from './usePaychecks';

/**
 * Which schedules and accounts belong to a paycheck. Membership lives only in
 * each paycheck's definition, so this indexes it for lists and the sidebar.
 */
export function usePaycheckMembership() {
  const { data: paychecks = [] } = usePaychecks();
  const scheduleIds = new Set<ScheduleEntity['id']>(
    paychecks.flatMap(({ definition }) =>
      [definition.paySchedule, ...definition.deposits.map(d => d.schedule)]
        // Never null after a save; older or corrupt rows may lack them
        .filter((id): id is string => !!id),
    ),
  );
  const byClearingAccount = new Map<AccountEntity['id'], PaycheckEntity>(
    paychecks.map(p => [p.definition.clearingAccount, p]),
  );
  return { scheduleIds, byClearingAccount };
}
