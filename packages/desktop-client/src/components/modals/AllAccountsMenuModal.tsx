import { useTranslation } from 'react-i18next';

import { importAmazonOrders } from '#components/accounts/importAmazonOrders';
import { MobileSheet } from '#components/mobile/MobileSheet';
import { MobileSheetRow } from '#components/mobile/MobileSheetRow';
import { MobileSheetSection } from '#components/mobile/MobileSheetSection';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useSyncedPref } from '#hooks/useSyncedPref';
import type { Modal as ModalType } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type AllAccountsMenuModalProps = Extract<
  ModalType,
  { name: 'all-accounts-menu' }
>['options'];

export function AllAccountsMenuModal({ onClose }: AllAccountsMenuModalProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const isAmazonOrdersEnabled = useFeatureFlag('amazonOrderItemization');
  const [hideReconciled, setHideReconciled] = useSyncedPref(
    'hide-reconciled-all',
  );

  return (
    <MobileSheet
      name="all-accounts-menu"
      title={t('All Accounts')}
      onClose={onClose}
    >
      {({ close }) => (
        <MobileSheetSection>
          <MobileSheetRow
            label={
              hideReconciled !== 'true'
                ? t('Hide reconciled transactions')
                : t('Show reconciled transactions')
            }
            onPress={() => {
              setHideReconciled(hideReconciled === 'true' ? 'false' : 'true');
            }}
          />
          {isAmazonOrdersEnabled && (
            <MobileSheetRow
              label={t('Import Amazon orders')}
              onPress={() => {
                close();
                // Phone transaction lists are live queries; nothing to refresh
                void importAmazonOrders(dispatch);
              }}
            />
          )}
        </MobileSheetSection>
      )}
    </MobileSheet>
  );
}
