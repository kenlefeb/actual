import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import { computePaycheck } from '@actual-app/core/shared/paychecks';
import {
  getRelativeOccurrences,
  isRelativeDate,
  toRelativeDay,
} from '@actual-app/core/shared/relative-dates';
import type {
  AccountEntity,
  PaycheckEntity,
  ScheduleEntity,
} from '@actual-app/core/types/models';

import { FinancialText } from '#components/FinancialText';
import { useAccounts } from '#hooks/useAccounts';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { useUndo } from '#hooks/useUndo';
import { pushModal } from '#modals/modalsSlice';
import { useSkipNextPaycheckMutation } from '#paychecks';
import { useDispatch } from '#redux';

import { ClearingWarning, useClearingStatus } from './ClearingAccount';

type PlannedDeposit = {
  id: string;
  account: AccountEntity['id'];
  amount: number;
  date: string;
};

type PlannedPaycheck = { date: string; deposits: PlannedDeposit[] };

export type PaycheckPlan = {
  netAmount: number;
  next: PlannedPaycheck | null;
  // Occurrences before the next one that were skipped, not posted
  skipped: string[];
  later: PlannedPaycheck[];
};

/**
 * The next paycheck (the pay schedule's stored next date, so it includes
 * skips), any skipped before it and the three after it, each with the date
 * every deposit is expected for that pay date.
 */
export function planPaycheck(
  { definition }: PaycheckEntity,
  scheduleById: Map<ScheduleEntity['id'], ScheduleEntity>,
  today: string,
): PaycheckPlan {
  const { netAmount, depositAmounts } = computePaycheck(definition);
  const pay = definition.paySchedule
    ? scheduleById.get(definition.paySchedule)
    : undefined;
  if (!pay?.next_date || pay.completed) {
    return { netAmount, next: null, skipped: [], later: [] };
  }

  const atPayDate = (date: string): PlannedPaycheck => ({
    date,
    deposits: definition.deposits.map(deposit => {
      const schedule = deposit.schedule
        ? scheduleById.get(deposit.schedule)
        : undefined;
      return {
        id: deposit.id,
        account: deposit.account,
        amount: depositAmounts.get(deposit.id) ?? 0,
        date:
          schedule && isRelativeDate(schedule._date)
            ? toRelativeDay(date, schedule._date)
            : date,
      };
    }),
  });

  // The pay schedule's own occurrences (moved off non-business days), as a
  // zero-day relative date
  const upcoming = getRelativeOccurrences(
    {
      relativeTo: {
        scheduleId: pay.id,
        offset: 0,
        unit: 'days',
        direction: 'after',
      },
    },
    monthUtils.parseDate(today),
    monthUtils.parseDate(monthUtils.addDays(today, 366)),
  );
  const next = pay.next_date;
  return {
    netAmount,
    next: atPayDate(next),
    // shortcut: pay schedules post on their date, so a later occurrence before
    // next_date was skipped; one posted early by hand would show as skipped
    skipped: upcoming.filter(date => date > today && date < next),
    later: upcoming
      .filter(date => date > next)
      .slice(0, 3)
      .map(atPayDate),
  };
}

type PaycheckRowProps = {
  paycheck: PaycheckEntity;
  plan: PaycheckPlan;
};

export function PaycheckRow({ paycheck, plan }: PaycheckRowProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const format = useFormat();
  const locale = useLocale();
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
        onPress={() =>
          dispatch(
            pushModal({
              modal: {
                name: 'paycheck-edit',
                options: { paycheckId: paycheck.id },
              },
            }),
          )
        }
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
        <Text key={date} style={{ color: theme.warningText }}>
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
            <Button onPress={() => setIsShowingMore(!isShowingMore)}>
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
                  date: formatDate(next.date, 'MMMM d, yyyy'),
                })}
              </Text>
              <Button onPress={() => setIsConfirmingSkip(false)}>
                <Trans>Keep it</Trans>
              </Button>
              <Button
                onPress={() =>
                  skipNext.mutate(
                    { id: paycheck.id },
                    {
                      onSuccess: () => {
                        setIsConfirmingSkip(false);
                        showUndoNotification({
                          message: t('Skipped the paycheck on {{date}}.', {
                            date: formatDate(next.date, 'MMMM d, yyyy'),
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
            <Button onPress={() => setIsConfirmingSkip(true)}>
              <Trans>Skip next paycheck</Trans>
            </Button>
          )}
        </View>
      )}
    </View>
  );
}
