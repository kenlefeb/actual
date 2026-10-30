import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { ScheduleEntity } from '@actual-app/core/types/models';

import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { usePaychecks } from '#hooks/usePaychecks';

import { useOpenPaycheck } from './PaycheckRow';

type PaycheckScheduleNoteProps = {
  scheduleId?: ScheduleEntity['id'];
};

// Paycheck schedules are regenerated from their paycheck, so edits belong there
export function PaycheckScheduleNote({
  scheduleId,
}: PaycheckScheduleNoteProps) {
  const openPaycheck = useOpenPaycheck();
  const { isNarrowWidth } = useResponsive();
  const paychecksEnabled = useFeatureFlag('paychecks');
  const { data: paychecks = [] } = usePaychecks();
  const paycheck =
    scheduleId != null
      ? paychecks.find(
          p =>
            p.definition.paySchedule === scheduleId ||
            p.definition.deposits.some(d => d.schedule === scheduleId),
        )
      : undefined;

  if (!paychecksEnabled || !paycheck) {
    return null;
  }
  return (
    <View
      role="note"
      style={{
        // Phones stack the text above the button (UX, sc-556)
        flexDirection: isNarrowWidth ? 'column' : 'row',
        alignItems: isNarrowWidth ? 'flex-start' : 'center',
        gap: 10,
        padding: 10,
        color: theme.pageTextSubdued,
      }}
    >
      <Text>
        <Trans>
          Part of paycheck "{{ name: paycheck.name }}". Changes made here are
          replaced the next time the paycheck is saved.
        </Trans>
      </Text>
      <Button
        onPress={() => openPaycheck(paycheck.id)}
        style={isNarrowWidth ? { height: styles.mobileMinHeight } : undefined}
      >
        <Trans>Edit paycheck</Trans>
      </Button>
    </View>
  );
}
