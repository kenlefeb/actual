import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import { styles } from '@actual-app/components/styles';
import { View } from '@actual-app/components/view';

import {
  useDeleteBusinessCalendarMutation,
  useUpdateBusinessCalendarMutation,
} from '#business-calendars';
import { MobileBackButton } from '#components/mobile/MobileBackButton';
import { StickyFormFooter } from '#components/mobile/StickyFormFooter';
import { BusinessCalendarEditor } from '#components/modals/BusinessCalendarsModal/BusinessCalendarEditor';
import { MobilePageHeader, Page } from '#components/Page';
import { useBusinessCalendars } from '#hooks/useBusinessCalendars';
import { useConfirmDelete } from '#hooks/useConfirmDelete';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useNavigate } from '#hooks/useNavigate';

export function MobileBusinessCalendarPage() {
  const isEnabled = useFeatureFlag('businessCalendars');
  if (!isEnabled) {
    return <Navigate to="/schedules" replace />;
  }
  return <CalendarEditorPage />;
}

function CalendarEditorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const confirmDelete = useConfirmDelete();
  const { id } = useParams<{ id: string }>();
  const { data: calendars = [], isPlaceholderData } = useBusinessCalendars();
  const updateCalendar = useUpdateBusinessCalendarMutation();
  const deleteCalendar = useDeleteBusinessCalendarMutation();
  const calendar = calendars.find(c => c.id === id);
  const close = () => void navigate(-1);

  // Wait for the calendar before seeding the editor's draft with it
  if (isPlaceholderData) {
    return null;
  }
  // Unknown id: a stale link, or deleted elsewhere while open
  if (!calendar) {
    return <Navigate to="/business-calendars" replace />;
  }

  const header = (
    <MobilePageHeader
      title={t('Edit business calendar')}
      leftContent={<MobileBackButton onPress={close} />}
    />
  );

  return (
    <BusinessCalendarEditor
      // Remount on saved changes (undo, sync) so the draft never goes stale
      key={JSON.stringify(calendar)}
      calendar={calendar}
      // A sticky full-width Save, as on the paycheck page
      renderPage={(body, saveButton) => (
        <Page
          header={header}
          padding={0}
          footer={<StickyFormFooter>{saveButton}</StickyFormFooter>}
        >
          {/* Keeps its height, so the page scrolls instead of squashing it */}
          <View style={{ padding: styles.mobileEditingPadding, flexShrink: 0 }}>
            {body}
          </View>
        </Page>
      )}
      onSave={draft => updateCalendar.mutate(draft, { onSuccess: close })}
      // Phones have no undo shortcut, so deleting asks first
      onDelete={calendarId =>
        confirmDelete({
          title: t('Delete calendar'),
          // Names the saved calendar and states only what deleting it changes
          message: t(
            'Delete "{{name}}"? Accounts and schedules that use it, including paycheck deposits, will skip only weekends.',
            { name: calendar.name },
          ),
          onConfirm: () =>
            deleteCalendar.mutate(calendarId, { onSuccess: close }),
        })
      }
    />
  );
}
