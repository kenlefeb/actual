import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';

import { Checkbox } from '#components/forms';
import {
  hasNativeTabBar,
  isNativeScreenOn,
  setNativeScreenOn,
} from '#native/nativeChrome';

import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

// Fork-only (sc-3751). Shown only inside the iOS app. Default off: the Budget
// tab shows the web screen until this is on; the change applies the next time
// the tab is shown.
export function NativeScreens() {
  const { t } = useTranslation();
  const [budgetOn, setBudgetOn] = useState(() => isNativeScreenOn('budget'));

  if (!hasNativeTabBar()) return null;

  return (
    <SettingsGroup title={t('Native screens')}>
      <SettingsRow
        htmlFor="settings-native-budget"
        title={<Trans>Native Budget screen</Trans>}
        description={
          <Text>
            <Trans>
              Show the Budget tab as a native iPhone screen, for envelope and
              tracking budgets. It starts the next time you open Budget. You can
              edit budgeted amounts there. Turn it off to go back.
            </Trans>
          </Text>
        }
        control={
          // 44pt: the touch target iOS expects
          <View
            style={{
              minWidth: 44,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Checkbox
              id="settings-native-budget"
              checked={budgetOn}
              onChange={() => {
                setNativeScreenOn('budget', !budgetOn);
                setBudgetOn(!budgetOn);
              }}
            />
          </View>
        }
      />
    </SettingsGroup>
  );
}
