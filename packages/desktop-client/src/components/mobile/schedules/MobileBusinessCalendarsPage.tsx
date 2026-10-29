import type { ReactNode } from 'react';
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
  // Actions read as links, so they can't be mistaken for saved calendars
  const actionStyle = {
    ...rowStyle,
    color: theme.pageTextLink,
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
      <View style={{ gap: 20, paddingTop: 10, flexShrink: 0 }}>
        <Section id="your-calendars" title={t('Your calendars')}>
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
        </Section>
        <Section id="start-from-preset" title={t('Start from a preset')}>
          {businessCalendarPresets.map(preset => {
            const calendar = calendarFromPreset(t, preset);
            return (
              <Button
                key={preset.id}
                variant="bare"
                style={actionStyle}
                isDisabled={createCalendar.isPending}
                onPress={() => create(calendar)}
              >
                <Trans>Copy {{ name: calendar.name }} preset</Trans>
              </Button>
            );
          })}
          <Button
            variant="bare"
            style={actionStyle}
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
        </Section>
      </View>
    </Page>
  );
}

type SectionProps = {
  id: string;
  title: string;
  children: ReactNode;
};

function Section({ id, title, children }: SectionProps) {
  return (
    <section
      aria-labelledby={id}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <Text id={id} style={{ fontWeight: 600, color: theme.pageTextSubdued }}>
        {title}
      </Text>
      {children}
    </section>
  );
}
