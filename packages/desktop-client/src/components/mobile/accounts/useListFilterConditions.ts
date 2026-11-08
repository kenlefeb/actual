import { useState } from 'react';
import { useLocation } from 'react-router';

import type { RuleConditionEntity } from '@actual-app/core/types/models';

function isTagCondition(condition: RuleConditionEntity) {
  return condition.field === 'notes' && condition.op === 'hasTags';
}

/**
 * Filter conditions of a mobile transaction list. They start from the
 * navigation state (report drill-downs) and the list can add one tag
 * condition on top, which replaces any earlier tag.
 */
export function useListFilterConditions() {
  const location = useLocation();
  const seed: RuleConditionEntity[] | undefined =
    location?.state?.filterConditions;
  const [conditions, setConditions] = useState<RuleConditionEntity[]>(
    seed ?? [],
  );
  const [prevSeed, setPrevSeed] = useState(seed);
  if (seed !== prevSeed) {
    setPrevSeed(seed);
    setConditions(seed ?? []);
  }

  const tagCondition = conditions.find(isTagCondition);
  const tagFilter =
    typeof tagCondition?.value === 'string' ? tagCondition.value : undefined;

  return {
    conditions,
    tagFilter,
    // Conditions other than the tag, for the "Filters applied" chip
    hasOtherConditions: conditions.some(c => !isTagCondition(c)),
    onNotesTagClick: (tag: string) =>
      setConditions(current =>
        current.some(c => isTagCondition(c) && c.value === tag)
          ? current
          : [
              ...current.filter(c => !isTagCondition(c)),
              { field: 'notes', op: 'hasTags', value: tag, type: 'string' },
            ],
      ),
    onClearTagFilter: () =>
      setConditions(current => current.filter(c => !isTagCondition(c))),
  };
}
