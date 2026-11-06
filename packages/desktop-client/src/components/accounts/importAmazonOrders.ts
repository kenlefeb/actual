import { send } from '@actual-app/core/platform/client/connection';
import type { Handlers } from '@actual-app/core/types/handlers';
import { t } from 'i18next';

import { pushModal } from '#modals/modalsSlice';
import { addNotification } from '#notifications/notificationsSlice';
import type { AppDispatch } from '#redux/store';

// Reads the chosen export on the device, then opens the review, or refuses a
// file that isn't an order export without opening one
export async function importAmazonOrders(
  dispatch: AppDispatch,
  onApplied?: () => void,
) {
  const res = await window.Actual.openFileDialog({
    filters: [{ name: t('Amazon order export'), extensions: ['csv'] }],
  });
  if (!res?.length) {
    return;
  }

  let result: Awaited<ReturnType<Handlers['amazon-orders-parse']>>;
  try {
    result = await send('amazon-orders-parse', { filepath: res[0] });
  } catch {
    result = { error: { missing: [] } };
  }
  if ('error' in result) {
    const { missing } = result.error;
    dispatch(
      addNotification({
        notification: {
          type: 'error',
          message:
            missing.length > 0
              ? t(
                  "This isn't an Amazon order export. It's missing: {{fields}}.",
                  { fields: missing.join(', ') },
                )
              : t("This isn't an Amazon order export."),
        },
      }),
    );
    return;
  }
  dispatch(
    pushModal({
      modal: {
        name: 'import-amazon-orders',
        options: { reviews: result.reviews, onApplied },
      },
    }),
  );
}
