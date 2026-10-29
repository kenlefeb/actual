import { useResponsive } from '@actual-app/components/hooks/useResponsive';

import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

// Calendar management is a modal on desktop and its own pages on phones
export function useOpenBusinessCalendars() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isNarrowWidth } = useResponsive();
  return () => {
    if (isNarrowWidth) {
      void navigate('/business-calendars');
    } else {
      dispatch(pushModal({ modal: { name: 'business-calendars' } }));
    }
  };
}
