import { useTranslation } from 'react-i18next';

import { send } from '@actual-app/core/platform/client/connection';
import type {
  AccountEntity,
  PaycheckDefinition,
  PaycheckEntity,
} from '@actual-app/core/types/models';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';

import { accountQueries } from '#accounts';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

import { paycheckQueries } from './queries';

function usePaycheckMutation<T, R>(
  mutationFn: (payload: T) => Promise<R>,
  errorMessage: string,
) {
  const queryClient = useQueryClient();
  const dispatch = useDispatch();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: paycheckQueries.lists(),
      });
      // Paychecks can create clearing accounts and use account settings
      await queryClient.invalidateQueries({
        queryKey: accountQueries.lists(),
      });
    },
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

export function useSavePaycheckMutation() {
  const { t } = useTranslation();
  return usePaycheckMutation(
    ({
      id,
      name,
      definition,
      newClearingAccountName,
    }: {
      id?: PaycheckEntity['id'];
      name: string;
      definition: PaycheckDefinition;
      newClearingAccountName?: string;
    }): Promise<unknown> =>
      id
        ? send('paycheck-update', { id, name, definition })
        : send('paycheck-create', { name, definition, newClearingAccountName }),
    t('There was an error saving the paycheck.'),
  );
}

export function useDeletePaycheckMutation() {
  const { t } = useTranslation();
  return usePaycheckMutation(
    ({ id }: { id: PaycheckEntity['id'] }) => send('paycheck-delete', { id }),
    t('There was an error deleting the paycheck.'),
  );
}

export function useSkipNextPaycheckMutation() {
  const { t } = useTranslation();
  return usePaycheckMutation(
    ({ id }: { id: PaycheckEntity['id'] }) =>
      send('paycheck-skip-next', { id }),
    t('There was an error skipping the paycheck.'),
  );
}

export function useSetAccountBusinessDaysMutation() {
  const { t } = useTranslation();
  return usePaycheckMutation(
    (payload: {
      id: AccountEntity['id'];
      businessCalendarId: string | null;
      depositDaysEarly: number;
    }) => send('account-set-business-days', payload),
    t("There was an error saving the account's business days."),
  );
}
