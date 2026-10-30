import { isFlagOn } from '@actual-app/core/shared/feature-flags';
import type { FeatureFlag } from '@actual-app/core/types/prefs';

import { useSelector } from '#redux';

// The rule lives in loot-core, so the server reads the same value (ADR 6)
export { FEATURE_FLAG_REQUIRES } from '@actual-app/core/shared/feature-flags';

export function useFeatureFlag(name: FeatureFlag): boolean {
  const prefs = useSelector(state => state.prefs.synced);
  return isFlagOn(prefs, name);
}
