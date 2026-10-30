import { useResponsive } from '@actual-app/components/hooks/useResponsive';

import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type ConfirmDelete = {
  // Names the phone sheet; the desktop dialog has its own title
  title: string;
  message: string;
  onConfirm: () => void;
};

// Asks before deleting: the mobile delete sheet on a phone, the shared
// confirm-delete dialog on wider layouts
export function useConfirmDelete() {
  const dispatch = useDispatch();
  const { isNarrowWidth } = useResponsive();
  return ({ title, message, onConfirm }: ConfirmDelete) =>
    dispatch(
      pushModal({
        modal: isNarrowWidth
          ? {
              name: 'mobile-confirm-delete',
              options: { title, message, onConfirm },
            }
          : { name: 'confirm-delete', options: { message, onConfirm } },
      }),
    );
}
