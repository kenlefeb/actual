import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { sync } from '#app/appSlice';
import { useSyncServerStatus } from '#hooks/useSyncServerStatus';
import { useSyncStatus } from '#hooks/useSyncStatus';
import { useDispatch } from '#redux';

export function MobileSyncStatus() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const server = useSyncServerStatus();
  const { isSyncing, syncState } = useSyncStatus();
  const local =
    server === 'no-server' || syncState === 'disabled' || syncState === 'local';
  const offline = server === 'offline' || syncState === 'offline';
  const label = local
    ? t('Local file — not syncing')
    : isSyncing
      ? t('Syncing…')
      : offline
        ? t('Offline — changes saved on this device')
        : syncState === 'error'
          ? t('Sync failed — try again')
          : syncState === 'synced'
            ? t('Synced')
            : t('Server online');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        padding: '4px 10px',
        borderBottom: `1px solid ${theme.formInputBorder}`,
        backgroundColor: theme.mobilePageBackground,
      }}
    >
      <Text
        role="status"
        aria-live="polite"
        style={{
          fontSize: 12,
          color: syncState === 'error' ? theme.errorText : theme.pageText,
        }}
      >
        {label}
      </Text>
      {!local && (
        <Button
          variant="bare"
          aria-label={t('Sync with server')}
          isDisabled={isSyncing}
          onPress={() => {
            void dispatch(sync());
          }}
        >
          <Trans>Sync</Trans>
        </Button>
      )}
    </View>
  );
}
