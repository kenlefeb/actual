import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Text } from '@actual-app/components/text';

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
              Shows the Budget tab as a native iPhone screen (envelope budgets).
              Turn it off to use the web screen.
            </Trans>
          </Text>
        }
        control={
          <Checkbox
            id="settings-native-budget"
            checked={budgetOn}
            onChange={() => {
              setNativeScreenOn('budget', !budgetOn);
              setBudgetOn(!budgetOn);
            }}
          />
        }
      />
    </SettingsGroup>
  );
}
