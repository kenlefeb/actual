import { useTranslation } from 'react-i18next';

import { send } from '@actual-app/core/platform/client/connection';
import type { BusinessCalendarEntity } from '@actual-app/core/types/models';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';

import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

import { businessCalendarQueries } from './queries';

function useCalendarMutation<T, R>(
  mutationFn: (payload: T) => Promise<R>,
  errorMessage: string,
) {
  const queryClient = useQueryClient();
  const dispatch = useDispatch();

  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: businessCalendarQueries.lists(),
      }),
    onError: (error: Error) => {
      dispatch(
        addNotification({
          notification: {
            id: uuidv4(),
            type: 'error',
            message: errorMessage,
            pre: error.message,
          },
        }),
      );
    },
  });
}

export function useCreateBusinessCalendarMutation() {
  const { t } = useTranslation();
  return useCalendarMutation(
    (calendar: Omit<BusinessCalendarEntity, 'id'>) =>
      send('business-calendar-create', calendar),
    t('There was an error creating the business calendar.'),
  );
}

export function useUpdateBusinessCalendarMutation() {
  const { t } = useTranslation();
  return useCalendarMutation(
    (calendar: BusinessCalendarEntity) =>
      send('business-calendar-update', calendar),
    t('There was an error saving the business calendar.'),
  );
}

export function useDeleteBusinessCalendarMutation() {
  const { t } = useTranslation();
  return useCalendarMutation(
    (id: BusinessCalendarEntity['id']) =>
      send('business-calendar-delete', { id }),
    t('There was an error deleting the business calendar.'),
  );
}
