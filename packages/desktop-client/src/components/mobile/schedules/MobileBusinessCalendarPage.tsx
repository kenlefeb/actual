import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import {
  useDeleteBusinessCalendarMutation,
  useUpdateBusinessCalendarMutation,
} from '#business-calendars';
import { MobileBackButton } from '#components/mobile/MobileBackButton';
import { BusinessCalendarEditor } from '#components/modals/BusinessCalendarsModal/BusinessCalendarEditor';
import { MobilePageHeader, Page } from '#components/Page';
import { useBusinessCalendars } from '#hooks/useBusinessCalendars';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

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
  const dispatch = useDispatch();
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
      // A sticky full-width Save, as on other full-page phone editors
      renderPage={(body, saveButton) => (
        <Page
          header={header}
          padding={0}
          footer={
            <View
              style={{
                paddingLeft: styles.mobileEditingPadding,
                paddingRight: styles.mobileEditingPadding,
                paddingTop: 10,
                paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
                backgroundColor: theme.tableHeaderBackground,
                borderTopWidth: 1,
                borderColor: theme.tableBorder,
              }}
            >
              {saveButton}
            </View>
          }
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
        dispatch(
          pushModal({
            modal: {
              name: 'confirm-delete',
              options: {
                message: t(
                  'Are you sure you want to delete this business calendar?',
                ),
                onConfirm: () =>
                  deleteCalendar.mutate(calendarId, { onSuccess: close }),
              },
            },
          }),
        )
      }
    />
  );
}
