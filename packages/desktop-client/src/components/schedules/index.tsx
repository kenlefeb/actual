import React, { useCallback, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { q } from '@actual-app/core/shared/query';
import type { ScheduleEntity } from '@actual-app/core/types/models';

import { Search } from '#components/common/Search';
import { FeatureErrorFallback } from '#components/FeatureErrorFallback';
import { Page } from '#components/Page';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useOpenBusinessCalendars } from '#hooks/useOpenBusinessCalendars';
import { usePaycheckMembership } from '#hooks/usePaycheckMembership';
import { useSchedules } from '#hooks/useSchedules';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { PaychecksSection } from './PaychecksSection';
import { SchedulesTable } from './SchedulesTable';
import type { ScheduleItemAction } from './SchedulesTable';

export function Schedules() {
  const { t } = useTranslation();

  const dispatch = useDispatch();
  const [filter, setFilter] = useState('');
  const businessCalendarsEnabled = useFeatureFlag('businessCalendars');
  const openBusinessCalendars = useOpenBusinessCalendars();
  const paychecksEnabled = useFeatureFlag('paychecks');

  const onEdit = useCallback(
    (id: ScheduleEntity['id']) => {
      dispatch(
        pushModal({ modal: { name: 'schedule-edit', options: { id } } }),
      );
    },
    [dispatch],
  );

  const onAdd = useCallback(() => {
    dispatch(pushModal({ modal: { name: 'schedule-edit', options: {} } }));
  }, [dispatch]);

  const onDiscover = useCallback(() => {
    dispatch(pushModal({ modal: { name: 'schedules-discover' } }));
  }, [dispatch]);

  const onChangeUpcomingLength = useCallback(() => {
    dispatch(pushModal({ modal: { name: 'schedules-upcoming-length' } }));
  }, [dispatch]);

  const onAction = useCallback(
    async (name: ScheduleItemAction, id: ScheduleEntity['id']) => {
      switch (name) {
        case 'post-transaction':
          await send('schedule/post-transaction', { id });
          break;
        case 'post-transaction-today':
          await send('schedule/post-transaction', { id, today: true });
          break;
        case 'skip':
          await send('schedule/skip-next-date', { id });
          break;
        case 'complete':
          await send('schedule/update', {
            schedule: { id, completed: true },
          });
          break;
        case 'restart':
          await send('schedule/update', {
            schedule: { id, completed: false },
            resetNextDate: true,
          });
          break;
        case 'delete':
          await send('schedule/delete', { id });
          break;
        default:
          throw new Error(`Unknown action: ${String(name)}`);
      }
    },
    [],
  );

  const schedulesQuery = useMemo(() => q('schedules').select('*'), []);
  const {
    isLoading: isSchedulesLoading,
    schedules,
    statuses,
  } = useSchedules({ query: schedulesQuery });
  // A paycheck's schedules are reached from its row and editor instead
  const { scheduleIds: paycheckScheduleIds } = usePaycheckMembership();
  const listedSchedules = paychecksEnabled
    ? schedules.filter(s => !paycheckScheduleIds.has(s.id))
    : schedules;

  return (
    <ErrorBoundary FallbackComponent={FeatureErrorFallback}>
      <Page header={t('Schedules')}>
        {paychecksEnabled && <PaychecksSection />}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: '0 0 15px',
          }}
        >
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              justifyContent: 'flex-end',
            }}
          >
            <Search
              placeholder={t('Filter schedules…')}
              value={filter}
              onChange={setFilter}
            />
          </View>
        </View>

        <SchedulesTable
          isLoading={isSchedulesLoading}
          schedules={listedSchedules}
          filter={filter}
          statuses={statuses}
          allowCompleted
          onSelect={onEdit}
          onAction={onAction}
          style={{ backgroundColor: theme.tableBackground }}
        />

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            margin: '20px 0',
            flexShrink: 0,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: '1em',
            }}
          >
            <Button onPress={onDiscover}>
              <Trans>Find schedules</Trans>
            </Button>
            <Button onPress={onChangeUpcomingLength}>
              <Trans>Change upcoming length</Trans>
            </Button>
            {businessCalendarsEnabled && (
              <Button onPress={openBusinessCalendars}>
                <Trans>Business calendars</Trans>
              </Button>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: '1em' }}>
            <Button variant="primary" onPress={onAdd}>
              <Trans>Add new schedule</Trans>
            </Button>
          </View>
        </View>
      </Page>
    </ErrorBoundary>
  );
}
