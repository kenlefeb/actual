import { useState } from 'react';
import { Trans } from 'react-i18next';

import { Input } from '@actual-app/components/input';
import { Paragraph } from '@actual-app/components/paragraph';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useSyncedPref } from '#hooks/useSyncedPref';

const DEFAULT_DAYS = '7';
const MAX_DAYS = 30;

// `^\d+$` and 1 to 30, as the engine reads it: `Number()` would accept `1e1`
const isValidDays = (value: string | undefined): value is string =>
  value != null &&
  /^\d+$/.test(value) &&
  parseInt(value, 10) >= 1 &&
  parseInt(value, 10) <= MAX_DAYS;

/** How old a synced bank balance may be and still pre-fill Reconcile (native-reconcile-flow D2). */
export function ReconcileBalanceAgeSetting() {
  const [stored, setStored] = useSyncedPref(
    'reconcile-bank-balance-max-age-days',
  );
  const [draft, setDraft] = useState<string | null>(null);
  const current = isValidDays(stored) ? stored : DEFAULT_DAYS;

  function commit(value: string) {
    // An invalid entry is dropped and the stored value shows again
    if (isValidDays(value)) setStored(value);
    setDraft(null);
  }

  return (
    <View
      style={{
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 8,
        padding: 16,
        backgroundColor: theme.tableBackground,
        gap: 12,
      }}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 17, fontWeight: 600 }}>
          <Trans>Reconcile</Trans>
        </Text>
        <Paragraph
          style={{ fontSize: 15, color: theme.pageTextSubdued, margin: 0 }}
        >
          <Trans>
            Reconcile starts from your bank&apos;s balance when it was synced
            recently. An older balance is offered but not filled in. Choose 1 to
            30 days.
          </Trans>
        </Paragraph>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <label htmlFor="reconcile-bank-balance-max-age-days">
          <Trans>Use the bank balance if synced within</Trans>
        </label>
        <Input
          id="reconcile-bank-balance-max-age-days"
          inputMode="numeric"
          style={{ width: 70, flexShrink: 0 }}
          value={draft ?? current}
          onChangeValue={setDraft}
          onUpdate={commit}
          onEnter={commit}
        />
        <Text>
          <Trans>days</Trans>
        </Text>
      </View>
    </View>
  );
}
