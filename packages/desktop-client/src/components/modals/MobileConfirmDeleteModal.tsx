import { useTranslation } from 'react-i18next';

import { MobileSheet } from '#components/mobile/MobileSheet';
import { MobileSheetConfirm } from '#components/mobile/MobileSheetConfirm';
import type { Modal as ModalType } from '#modals/modalsSlice';

type MobileConfirmDeleteModalProps = Extract<
  ModalType,
  { name: 'mobile-confirm-delete' }
>['options'];

// The phone delete sheet: the same confirm layout as the category delete
// sheet, with a red Delete and full-width touch-sized buttons
export function MobileConfirmDeleteModal({
  title,
  message,
  onConfirm,
}: MobileConfirmDeleteModalProps) {
  const { t } = useTranslation();
  return (
    <MobileSheet name="mobile-confirm-delete" title={title}>
      {({ close }) => (
        <MobileSheetConfirm
          message={message}
          confirmLabel={t('Delete')}
          isDestructive
          onCancel={close}
          onConfirm={() => {
            onConfirm();
            close();
          }}
        />
      )}
    </MobileSheet>
  );
}
