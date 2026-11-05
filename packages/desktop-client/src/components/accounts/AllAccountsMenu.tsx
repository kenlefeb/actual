import { useTranslation } from 'react-i18next';

import { Menu } from '@actual-app/components/menu';

import { useFeatureFlag } from '#hooks/useFeatureFlag';

export type AllAccountsMenuItem =
  | 'remove-sorting'
  | 'export'
  | 'toggle-net-worth-chart'
  | 'toggle-reconciled'
  | 'manage-columns'
  | 'import-amazon-orders';

type AllAccountsMenuProps = {
  isSorted: boolean;
  showNetWorthChart: boolean;
  showReconciled: boolean;
  onMenuSelect: (item: AllAccountsMenuItem) => void;
};

// The menu of the all-accounts view (no single account is open)
export function AllAccountsMenu({
  isSorted,
  showNetWorthChart,
  showReconciled,
  onMenuSelect,
}: AllAccountsMenuProps) {
  const { t } = useTranslation();
  const amazonOrdersEnabled = useFeatureFlag('amazonOrderItemization');

  return (
    <Menu
      slot="close"
      onMenuSelect={onMenuSelect}
      items={[
        ...(isSorted
          ? [{ name: 'remove-sorting', text: t('Remove all sorting') } as const]
          : []),
        { name: 'export', text: t('Export') },
        {
          name: 'toggle-net-worth-chart',
          text: showNetWorthChart
            ? t('Hide balance chart')
            : t('Show balance chart'),
        },
        {
          name: 'toggle-reconciled',
          text: showReconciled
            ? t('Hide reconciled transactions')
            : t('Show reconciled transactions'),
        },
        { name: 'manage-columns', text: t('Manage table columns') },
        ...(amazonOrdersEnabled
          ? [
              {
                name: 'import-amazon-orders',
                text: t('Import Amazon orders'),
              } as const,
            ]
          : []),
      ]}
    />
  );
}
