import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { listen, send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';

import { useLocale } from '#hooks/useLocale';
import {
  isNativeReconcileOn,
  presentNativeReconcile,
} from '#native/nativeChrome';

type Checklist = {
  month: string;
  accounts: { status: string }[];
};

// Tables whose changes can change what is due
const WATCHED = ['transactions', 'accounts', 'preferences'];

// Fork-only (sc-4801, native-reconcile-flow D1). The Accounts tab's entry to
// the native "Reconcile this month" checklist: rendered only in the iOS app
// with the switch on. It shows while something is due and collapses to a
// reconciled line for the rest of the month.
export function NativeReconcileBanner() {
  const { t } = useTranslation();
  const locale = useLocale();
  const isOn = isNativeReconcileOn();
  const [checklist, setChecklist] = useState<Checklist | null>(null);

  useEffect(() => {
    if (!isOn) return undefined;
    let isCurrent = true;
    const read = () =>
      void send('native/reconcile-month', undefined).then(result => {
        if (isCurrent) setChecklist(result);
      });
    read();
    const unlisten = listen('sync-event', event => {
      if (
        (event.type === 'applied' || event.type === 'success') &&
        event.tables.some(table => WATCHED.includes(table))
      ) {
        read();
      }
    });
    return () => {
      isCurrent = false;
      unlisten();
    };
  }, [isOn]);

  if (!isOn || !checklist || checklist.accounts.length === 0) return null;

  const month = monthUtils.format(checklist.month, 'MMMM', locale);
  const done = checklist.accounts.filter(a => a.status === 'done').length;
  const due = checklist.accounts.length - done;

  return (
    <Button
      variant="bare"
      aria-label={
        due > 0
          ? t('Reconcile {{month}}. {{due}} due, {{done}} done', {
              month,
              due,
              done,
            })
          : t('{{month}} reconciled', { month })
      }
      onPress={() => presentNativeReconcile('checklist')}
      style={{
        margin: '8px 12px',
        padding: '12px 16px',
        minHeight: 44,
        borderRadius: 12,
        justifyContent: 'flex-start',
        backgroundColor: theme.tableBackground,
      }}
    >
      {due > 0 ? (
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <Text style={{ fontWeight: 600, color: theme.pageText }}>
            <Trans>Reconcile {{ month }}</Trans>
          </Text>
          <Text style={{ fontSize: 13, color: theme.pageTextSubdued }}>
            <Trans>
              {{ due }} due · {{ done }} done
            </Trans>
          </Text>
        </View>
      ) : (
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>{{ month }} reconciled ✓</Trans>
        </Text>
      )}
    </Button>
  );
}
