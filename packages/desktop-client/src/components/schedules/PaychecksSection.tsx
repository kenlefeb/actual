import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import type {
  PaycheckEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { useBusinessCalendarLookup } from '#hooks/useBusinessCalendarLookup';
import { usePaychecks } from '#hooks/usePaychecks';
import { useQuery } from '#hooks/useQuery';
import { useScheduleDateLookup } from '#hooks/useScheduleDateLookup';
import { useTouchTargetStyle } from '#hooks/useTouchTargetStyle';

import { PaycheckRow, planPaycheck, useOpenPaycheck } from './PaycheckRow';

// Stable while loading, so the transactions query isn't rebuilt every render
const NO_PAYCHECKS: PaycheckEntity[] = [];

export function PaychecksSection() {
  const openPaycheck = useOpenPaycheck();
  const touchTarget = useTouchTargetStyle();
  const { data: paychecks = NO_PAYCHECKS } = usePaychecks();
  // Fill the lookups the deposit date math reads
  const { schedules } = useScheduleDateLookup();
  useBusinessCalendarLookup();

  // Posted pay transactions tell a paycheck posted early from a skipped one
  const payTransactions =
    useQuery<Pick<TransactionEntity, 'schedule' | 'date'>>(
      () =>
        q('transactions')
          .filter({
            schedule: {
              $oneof: paychecks.flatMap(p => p.definition.paySchedule ?? []),
            },
          })
          .select(['schedule', 'date']),
      [paychecks],
    ).data ?? [];

  const today = currentDay();
  const scheduleById = new Map(schedules.map(s => [s.id, s]));
  const rows = paychecks
    .map(paycheck => ({
      paycheck,
      plan: planPaycheck(
        paycheck,
        scheduleById,
        today,
        payTransactions.flatMap(t =>
          t.schedule === paycheck.definition.paySchedule ? t.date : [],
        ),
      ),
    }))
    // Paychecks without a next date (e.g. ended) go last
    .sort((a, b) =>
      (a.plan.next?.date ?? '9999').localeCompare(b.plan.next?.date ?? '9999'),
    );

  return (
    <section
      aria-labelledby="paychecks-heading"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginBottom: 15,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text id="paychecks-heading" style={styles.mediumText}>
          <Trans>Paychecks</Trans>
        </Text>
        <Button style={touchTarget} onPress={() => openPaycheck()}>
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
    </section>
  );
}
