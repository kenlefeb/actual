import { Trans, useTranslation } from 'react-i18next';

import { SvgMoneyBag } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import type { CSSProperties } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  AccountEntity,
  PaycheckClearingStatus,
  PaycheckEntity,
} from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';

import { useAccounts } from '#hooks/useAccounts';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useFormat } from '#hooks/useFormat';
import { useFormatList } from '#hooks/useFormatList';
import { usePaycheckMembership } from '#hooks/usePaycheckMembership';
import { paycheckQueries } from '#paychecks';

function useClearingPaycheck(accountId: AccountEntity['id']) {
  const paychecksEnabled = useFeatureFlag('paychecks');
  const { byClearingAccount } = usePaycheckMembership();
  return paychecksEnabled ? byClearingAccount.get(accountId) : undefined;
}

// Marks a paycheck's clearing account in the sidebars
export function ClearingAccountIcon({
  accountId,
  size = 11,
}: {
  accountId: AccountEntity['id'];
  size?: number;
}) {
  const { t } = useTranslation();
  const paycheck = useClearingPaycheck(accountId);
  if (!paycheck) {
    return null;
  }
  const label = t('Clearing account for paycheck "{{name}}"', {
    name: paycheck.name,
  });
  return (
    <span title={label} style={{ flexShrink: 0, marginLeft: 5 }}>
      <SvgMoneyBag
        aria-hidden
        width={size}
        height={size}
        style={{ verticalAlign: 'middle' }}
      />
      <Text style={styles.visuallyHidden}>{label}</Text>
    </span>
  );
}

export function useClearingStatus(
  paycheckId: PaycheckEntity['id'] | undefined,
) {
  const { data: statuses = [] } = useQuery(paycheckQueries.clearingStatus());
  return statuses.find(s => s.paycheck === paycheckId);
}

// The balance left in a clearing account and the deposits it waits on
export function ClearingWarning({
  status,
}: {
  status: PaycheckClearingStatus;
}) {
  const { i18n } = useTranslation();
  const format = useFormat();
  const { data: accounts = [] } = useAccounts();
  const accountName = (id: string) => accounts.find(a => a.id === id)?.name;
  const missing = status.missingDeposits.map(d => (
    <Text key={d.id}>{accountName(d.account)}</Text>
  ));
  const missingList = useFormatList(missing, i18n.language);
  const amount = format(status.balance, 'financial');
  const account = accountName(status.clearingAccount);

  return (
    <Text style={{ color: theme.paycheckWarningText }}>
      {missing.length === 0 ? (
        <Trans>
          {{ amount }} is still in "{{ account }}
          ".
        </Trans>
      ) : missing.length === 1 ? (
        <Trans>
          {{ amount }} is still in "{{ account }}
          ", waiting on the deposit to{' '}
          {{ deposit: accountName(status.missingDeposits[0].account) }}.
        </Trans>
      ) : (
        <Trans>
          {{ amount }} is still in "{{ account }}
          ", waiting on the deposits to <span>{missingList}</span>.
        </Trans>
      )}
    </Text>
  );
}

// At the top of a clearing account's register
export function ClearingAccountNote({
  accountId,
  style,
  isWarningOnOwnLine = false,
}: {
  accountId: AccountEntity['id'];
  style?: CSSProperties;
  // Phones put the warning on its own line below the note
  isWarningOnOwnLine?: boolean;
}) {
  const paycheck = useClearingPaycheck(accountId);
  const status = useClearingStatus(paycheck?.id);
  if (!paycheck) {
    return null;
  }
  return (
    <View
      style={{
        ...styles.pageContent,
        paddingBottom: 10,
        color: theme.clearingNoteText,
        ...style,
      }}
    >
      <aside>
        <Text>
          <Trans>
            Clearing account for paycheck "{{ name: paycheck.name }}". It should
            return to zero after each payday.
          </Trans>
        </Text>
        {status?.isWarning &&
          (isWarningOnOwnLine ? (
            <View style={{ marginTop: 5 }}>
              <ClearingWarning status={status} />
            </View>
          ) : (
            <>
              {' '}
              <ClearingWarning status={status} />
            </>
          ))}
      </aside>
    </View>
  );
}
