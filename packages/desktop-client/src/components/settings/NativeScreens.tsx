import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';

import { Checkbox } from '#components/forms';
import {
  hasNativeTabBar,
  isNativeReconcileOn,
  isNativeScreenOn,
  setNativeScreenOn,
} from '#native/nativeChrome';

import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

// Fork-only (sc-3751). Shown only inside the iOS app. Budget and Paychecks are
// on unless turned off here (sc-5090); the change applies the next time the
// tab is shown.
export function NativeScreens() {
  const { t } = useTranslation();
  const [budgetOn, setBudgetOn] = useState(() => isNativeScreenOn('budget'));
  const [paychecksOn, setPaychecksOn] = useState(() =>
    isNativeScreenOn('paychecks'),
  );
  // sc-4801: on unless turned off here
  const [reconcileOn, setReconcileOn] = useState(() => isNativeReconcileOn());

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
              edit budgeted amounts and move money there. Turn it off to go
              back.
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
      <SettingsRow
        htmlFor="settings-native-paychecks"
        title={<Trans>Native Schedules & Paychecks screen</Trans>}
        description={
          <Text>
            <Trans>
              Show Schedules as a native iPhone screen, paychecks first. It
              starts the next time you open Schedules. You can skip a paycheck
              and undo it there. Turn it off to go back.
            </Trans>
          </Text>
        }
        control={
          <View
            style={{
              minWidth: 44,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Checkbox
              id="settings-native-paychecks"
              checked={paychecksOn}
              onChange={() => {
                setNativeScreenOn('paychecks', !paychecksOn);
                setPaychecksOn(!paychecksOn);
              }}
            />
          </View>
        }
      />
      <SettingsRow
        htmlFor="settings-native-reconcile"
        title={<Trans>Native Reconcile</Trans>}
        description={
          <Text>
            <Trans>
              Reconcile accounts on native iPhone screens, from the Accounts
              banner or an account's Reconcile… menu item. Turn it off to use
              the web dialog instead.
            </Trans>
          </Text>
        }
        control={
          <View
            style={{
              minWidth: 44,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Checkbox
              id="settings-native-reconcile"
              checked={reconcileOn}
              onChange={() => {
                setNativeScreenOn('reconcile', !reconcileOn);
                setReconcileOn(!reconcileOn);
              }}
            />
          </View>
        }
      />
    </SettingsGroup>
  );
}
