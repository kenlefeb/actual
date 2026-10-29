import { Trans, useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { businessCalendarPresets } from '@actual-app/core/shared/business-calendar-presets';
import type { BusinessCalendarEntity } from '@actual-app/core/types/models';

import { useCreateBusinessCalendarMutation } from '#business-calendars';
import { MobileBackButton } from '#components/mobile/MobileBackButton';
import { calendarFromPreset } from '#components/modals/BusinessCalendarsModal/presetTranslations';
import { MobilePageHeader, Page } from '#components/Page';
import { useBusinessCalendars } from '#hooks/useBusinessCalendars';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useNavigate } from '#hooks/useNavigate';

export function MobileBusinessCalendarsPage() {
  const isEnabled = useFeatureFlag('businessCalendars');
  if (!isEnabled) {
    return <Navigate to="/schedules" replace />;
  }
  return <CalendarList />;
}

function CalendarList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: calendars = [] } = useBusinessCalendars();
  const createCalendar = useCreateBusinessCalendarMutation();

  const open = (id: BusinessCalendarEntity['id']) =>
    void navigate(`/business-calendars/${id}`);

  function create(calendar: Omit<BusinessCalendarEntity, 'id'>) {
    createCalendar.mutate(calendar, { onSuccess: open });
  }

  const rowStyle = {
    justifyContent: 'flex-start',
    minHeight: styles.mobileMinHeight,
  } as const;

  return (
    <Page
      header={
        <MobilePageHeader
          title={t('Business calendars')}
          leftContent={<MobileBackButton />}
        />
      }
    >
      <View style={{ gap: 10 }}>
        {calendars.length === 0 && (
          <Text style={{ color: theme.pageTextSubdued }}>
            <Trans>
              Create a calendar, or copy a preset, to define which days are
              business days.
            </Trans>
          </Text>
        )}
        {calendars.map(calendar => (
          <Button
            key={calendar.id}
            style={{ ...rowStyle, fontSize: 16 }}
            onPress={() => open(calendar.id)}
          >
            {calendar.name}
          </Button>
        ))}
        <Button
          variant="primary"
          style={rowStyle}
          isDisabled={createCalendar.isPending}
          onPress={() =>
            create({
              name: t('New calendar'),
              nonWorkingDays: [0, 6],
              holidays: [],
              exceptions: [],
            })
          }
        >
          <Trans>New calendar</Trans>
        </Button>
        {businessCalendarPresets.map(preset => {
          const calendar = calendarFromPreset(t, preset);
          return (
            <Button
              key={preset.id}
              style={rowStyle}
              isDisabled={createCalendar.isPending}
              onPress={() => create(calendar)}
            >
              <Trans>Copy {{ name: calendar.name }} preset</Trans>
            </Button>
          );
        })}
      </View>
    </Page>
  );
}
