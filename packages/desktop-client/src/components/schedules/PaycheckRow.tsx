import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import type {
  PaycheckPlan,
  PlannedPaycheck,
} from '@actual-app/core/shared/paychecks';
import type { PaycheckEntity } from '@actual-app/core/types/models';

import { FinancialText } from '#components/FinancialText';
import { useAccounts } from '#hooks/useAccounts';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { useNavigate } from '#hooks/useNavigate';
import { useTouchTargetStyle } from '#hooks/useTouchTargetStyle';
import { useUndo } from '#hooks/useUndo';
import { pushModal } from '#modals/modalsSlice';
import { useSkipNextPaycheckMutation } from '#paychecks';
import { useDispatch } from '#redux';

import { ClearingWarning, useClearingStatus } from './ClearingAccount';

// The editor is a modal on desktop and its own page on phones; no id adds one
export function useOpenPaycheck() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isNarrowWidth } = useResponsive();
  return (paycheckId?: PaycheckEntity['id']) => {
    if (isNarrowWidth) {
      void navigate(`/paychecks/${paycheckId ?? 'new'}`);
    } else {
      dispatch(
        pushModal({
          modal: { name: 'paycheck-edit', options: { paycheckId } },
        }),
      );
    }
  };
}

type PaycheckRowProps = {
  paycheck: PaycheckEntity;
  plan: PaycheckPlan;
};

export function PaycheckRow({ paycheck, plan }: PaycheckRowProps) {
  const { t } = useTranslation();
  const openPaycheck = useOpenPaycheck();
  const format = useFormat();
  const locale = useLocale();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const touchTarget = useTouchTargetStyle();
  const { showUndoNotification } = useUndo();
  const skipNext = useSkipNextPaycheckMutation();
  const { data: accounts = [] } = useAccounts();
  const [isShowingMore, setIsShowingMore] = useState(false);
  const [isConfirmingSkip, setIsConfirmingSkip] = useState(false);
  const clearing = useClearingStatus(paycheck.id);

  const formatDate = (date: string, pattern: string) =>
    monthUtils.format(date, pattern, locale);
  const accountName = (id: string) =>
    accounts.find(a => a.id === id)?.name ?? t('Unknown account');
  const { next } = plan;

  const renderPaycheck = ({ date, deposits }: PlannedPaycheck) => (
    <View key={date} style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Text>{formatDate(date, 'EEEE, MMMM d, yyyy')}</Text>
        <FinancialText style={{ fontWeight: 600 }}>
          {format(plan.netAmount, 'financial')}
        </FinancialText>
      </View>
      {deposits.map(deposit => (
        <Text key={deposit.id} style={{ color: theme.pageTextSubdued }}>
          {accountName(deposit.account)} ·{' '}
          <FinancialText>{format(deposit.amount, 'financial')}</FinancialText> ·{' '}
          {formatDate(deposit.date, 'EEEE, MMMM d')}
        </Text>
      ))}
    </View>
  );

  return (
    <View
      style={{
        backgroundColor: theme.tableBackground,
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 4,
        padding: 10,
        gap: 8,
      }}
    >
      <Button
        variant="bare"
        aria-label={t('Edit paycheck {{name}}', { name: paycheck.name })}
        style={{ justifyContent: 'flex-start', textAlign: 'left' }}
        onPress={() => openPaycheck(paycheck.id)}
      >
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: 600 }}>{paycheck.name}</Text>
          {next ? (
            renderPaycheck(next)
          ) : (
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>No upcoming paychecks</Trans>
            </Text>
          )}
        </View>
      </Button>
      {plan.skipped.map(date => (
        <Text key={date} style={{ color: theme.paycheckWarningText }}>
          {t('Skipped: {{date}}', { date: formatDate(date, 'EEEE, MMMM d') })}
        </Text>
      ))}
      {clearing?.isWarning && <ClearingWarning status={clearing} />}
      {isShowingMore && plan.later.map(renderPaycheck)}
      {next && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {plan.later.length > 0 && (
            <Button
              style={touchTarget}
              onPress={() => setIsShowingMore(!isShowingMore)}
            >
              {isShowingMore ? (
                <Trans>Show less</Trans>
              ) : (
                <Trans>Show more</Trans>
              )}
            </Button>
          )}
          {isConfirmingSkip ? (
            <>
              <Text>
                {t('Skip the paycheck on {{date}}?', {
                  date: monthUtils.format(next.date, dateFormat),
                })}
              </Text>
              <Button
                style={touchTarget}
                onPress={() => setIsConfirmingSkip(false)}
              >
                <Trans>Keep it</Trans>
              </Button>
              <Button
                style={touchTarget}
                onPress={() =>
                  skipNext.mutate(
                    { id: paycheck.id },
                    {
                      onSuccess: () => {
                        setIsConfirmingSkip(false);
                        showUndoNotification({
                          message: t('Skipped the paycheck on {{date}}.', {
                            date: monthUtils.format(next.date, dateFormat),
                          }),
                        });
                      },
                    },
                  )
                }
              >
                <Trans>Skip it</Trans>
              </Button>
            </>
          ) : (
            <Button
              style={touchTarget}
              onPress={() => setIsConfirmingSkip(true)}
            >
              <Trans>Skip next paycheck</Trans>
            </Button>
          )}
        </View>
      )}
    </View>
  );
}
