import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';

import { useBusinessCalendarLookup } from '#hooks/useBusinessCalendarLookup';
import { usePaychecks } from '#hooks/usePaychecks';
import { useScheduleDateLookup } from '#hooks/useScheduleDateLookup';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { PaycheckRow, planPaycheck } from './PaycheckRow';

export function PaychecksSection() {
  const dispatch = useDispatch();
  const { data: paychecks = [] } = usePaychecks();
  // Fill the lookups the deposit date math reads
  const { schedules } = useScheduleDateLookup();
  useBusinessCalendarLookup();

  const today = currentDay();
  const scheduleById = new Map(schedules.map(s => [s.id, s]));
  const rows = paychecks
    .map(paycheck => ({
      paycheck,
      plan: planPaycheck(paycheck, scheduleById, today),
    }))
    // Paychecks without a next date (e.g. ended) go last
    .sort((a, b) =>
      (a.plan.next?.date ?? '9999').localeCompare(b.plan.next?.date ?? '9999'),
    );

  const onAdd = () =>
    dispatch(pushModal({ modal: { name: 'paycheck-edit', options: {} } }));

  return (
    <View
      role="region"
      aria-labelledby="paychecks-heading"
      style={{ gap: 10, marginBottom: 15 }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text id="paychecks-heading" style={{ fontSize: 16, fontWeight: 600 }}>
          <Trans>Paychecks</Trans>
        </Text>
        <Button onPress={onAdd}>
          <Trans>Add paycheck</Trans>
        </Button>
      </View>
      {rows.length === 0 ? (
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>
            Set up a paycheck to see what lands in each account, and when.
          </Trans>
        </Text>
      ) : (
        rows.map(({ paycheck, plan }) => (
          <PaycheckRow key={paycheck.id} paycheck={paycheck} plan={plan} />
        ))
      )}
    </View>
  );
}
