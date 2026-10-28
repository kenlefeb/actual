import type { FeatureFlag } from '@actual-app/core/types/prefs';
import { useQuery } from '@tanstack/react-query';

import { paycheckQueries } from '#paychecks';

import { useSyncedPref } from './useSyncedPref';

const DEFAULT_FEATURE_FLAG_STATE: Record<FeatureFlag, boolean> = {
  newSidebarUI: false,
  goalTemplatesEnabled: false,
  goalTemplatesUIEnabled: false,
  actionTemplating: false,
  formulaMode: false,
  currency: false,
  balanceForecastReport: false,
  customThemes: false,
  budgetAnalysisReport: false,
  enableBanking: false,
  sankeyReport: false,
  akahuBankSync: false,
  mobileCalculator: false,
  monteCarloReport: false,
  businessCalendars: false,
  paychecks: false,
};

export function useFeatureFlag(name: FeatureFlag): boolean {
  const [value] = useSyncedPref(`flags.${name}`);
  const [businessCalendars] = useSyncedPref('flags.businessCalendars');
  // Unset paychecks flag stays on for budgets that used paychecks before it existed
  const derivesPaychecks =
    name === 'paychecks' &&
    value === undefined &&
    String(businessCalendars) !== 'true';
  const { data: paychecks = [] } = useQuery({
    ...paycheckQueries.list(),
    enabled: derivesPaychecks,
  });

  if (value !== undefined) {
    return String(value) === 'true';
  }
  if (name === 'paychecks') {
    return String(businessCalendars) === 'true' || paychecks.length > 0;
  }
  return DEFAULT_FEATURE_FLAG_STATE[name] || false;
}
