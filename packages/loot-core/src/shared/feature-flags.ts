import type { FeatureFlag, SyncedPrefs } from '#types/prefs';

// The one place a flag's effective value is computed (ADR 6), used by the
// UI's useFeatureFlag and Experimental settings, and by the server

export const DEFAULT_FEATURE_FLAG_STATE: Record<FeatureFlag, boolean> = {
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
  // On by default, so an unset flag follows the flags it requires
  paychecks: true,
};

/**
 * Which flags each flag needs (ADR 6). A flag counts as on only while all of
 * them are on; turning it on turns them on, and turning one of them off turns
 * it off. One level deep: a required flag must not require others.
 */
export const FEATURE_FLAG_REQUIRES: Partial<
  Record<FeatureFlag, FeatureFlag[]>
> = {
  paychecks: ['businessCalendars'],
};

function isStoredOn(
  prefs: SyncedPrefs,
  name: FeatureFlag,
): boolean | undefined {
  const value = prefs[`flags.${name}`];
  return value === undefined ? undefined : String(value) === 'true';
}

export function isFlagOn(prefs: SyncedPrefs, name: FeatureFlag): boolean {
  const requirementsOn = (FEATURE_FLAG_REQUIRES[name] ?? []).every(
    required =>
      isStoredOn(prefs, required) ?? DEFAULT_FEATURE_FLAG_STATE[required],
  );
  return (
    (isStoredOn(prefs, name) ?? DEFAULT_FEATURE_FLAG_STATE[name]) &&
    requirementsOn
  );
}
