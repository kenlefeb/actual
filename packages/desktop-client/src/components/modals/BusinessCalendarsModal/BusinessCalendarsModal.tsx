import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { businessCalendarPresets } from '@actual-app/core/shared/business-calendar-presets';
import type { BusinessCalendarEntity } from '@actual-app/core/types/models';

import {
  useCreateBusinessCalendarMutation,
  useDeleteBusinessCalendarMutation,
  useUpdateBusinessCalendarMutation,
} from '#business-calendars';
import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { useBusinessCalendars } from '#hooks/useBusinessCalendars';

import { BusinessCalendarEditor } from './BusinessCalendarEditor';
import { calendarFromPreset } from './presetTranslations';

export function BusinessCalendarsModal() {
  const { t } = useTranslation();
  const { data: calendars = [] } = useBusinessCalendars();
  const [selectedId, setSelectedId] = useState<
    BusinessCalendarEntity['id'] | null
  >(null);

  const createCalendar = useCreateBusinessCalendarMutation();
  const updateCalendar = useUpdateBusinessCalendarMutation();
  const deleteCalendar = useDeleteBusinessCalendarMutation();

  const selected =
    calendars.find(calendar => calendar.id === selectedId) ?? calendars[0];

  function create(calendar: Omit<BusinessCalendarEntity, 'id'>) {
    createCalendar.mutate(calendar, {
      onSuccess: id => setSelectedId(id),
    });
  }

  return (
    <Modal
      name="business-calendars"
      containerProps={{ style: { width: '80vw', maxWidth: 1100 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={t('Business calendars')} />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <View style={{ width: 220, gap: 5, flexShrink: 0 }}>
              {calendars.map(calendar => (
                <Button
                  key={calendar.id}
                  variant="bare"
                  aria-pressed={calendar.id === selected?.id}
                  onPress={() => setSelectedId(calendar.id)}
                  style={{
                    justifyContent: 'flex-start',
                    fontWeight: calendar.id === selected?.id ? 600 : 400,
                  }}
                >
                  {calendar.name}
                </Button>
              ))}
              <Button
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
                  <Button key={preset.id} onPress={() => create(calendar)}>
                    <Trans>Copy {{ name: calendar.name }} preset</Trans>
                  </Button>
                );
              })}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {selected ? (
                <BusinessCalendarEditor
                  // Remount on saved changes (undo, sync) so the draft never goes stale
                  key={JSON.stringify(selected)}
                  calendar={selected}
                  onSave={calendar => updateCalendar.mutate(calendar)}
                  onDelete={id => {
                    deleteCalendar.mutate(id);
                    setSelectedId(null);
                  }}
                />
              ) : (
                <Text style={{ color: theme.pageTextSubdued }}>
                  <Trans>
                    Create a calendar, or copy a preset, to define which days
                    are business days.
                  </Trans>
                </Text>
              )}
            </View>
          </View>
        </>
      )}
    </Modal>
  );
}
