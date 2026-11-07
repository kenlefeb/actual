import { Fzf } from 'fzf';

type CategorySuggestion = {
  id: string;
  name: string;
  group?: { name: string };
};

function rankMatches<T extends CategorySuggestion>(
  items: T[],
  value: string,
  selector: (item: CategorySuggestion) => string,
): T[] {
  const itemsById = new Map(items.map(item => [item.id, item]));
  return new Fzf<CategorySuggestion[]>(items, {
    selector,
    limit: 100,
    casing: 'case-insensitive',
  })
    .find(value)
    .map(result => itemsById.get(result.item.id))
    .filter(item => item != null);
}

export function filterCategorySuggestions<T extends CategorySuggestion>(
  suggestions: T[],
  rawValue: string,
): T[] {
  const value = rawValue.trim();
  const splitItem = suggestions.find(s => s.id === 'split');
  const realSuggestions = suggestions.filter(s => s.id !== 'split');

  if (!value) {
    return suggestions;
  }

  // matches on the category name itself rank above matches that
  // only hit the group name
  const nameMatches = rankMatches(realSuggestions, value, item => item.name);

  const nameMatchIds = new Set(nameMatches.map(item => item.id));
  // group-aware searches must match contiguously: fuzzy matching across
  // "group + name" lists unrelated categories (e.g. "allow" vs "Taxes & Fees
  // Local Income Tax Withholding")
  const needle = value.toLowerCase();
  const groupMatches = realSuggestions.filter(
    item =>
      !nameMatchIds.has(item.id) &&
      (item.group ? item.group.name + ' ' + item.name : item.name)
        .toLowerCase()
        .includes(needle),
  );

  const filtered = [...nameMatches, ...groupMatches].slice(0, 100);

  return splitItem ? [splitItem, ...filtered] : filtered;
}

// Prepends a "create" sentinel (id `new`, after the split item) when the typed
// text is not already a category name, like the payee picker does.
export function addCreateSuggestion<T extends CategorySuggestion>(
  filtered: T[],
  // every existing category, including ones hidden from the picker
  all: Array<{ name: string }>,
  rawValue: string,
): T[] {
  const value = rawValue.trim().toLowerCase();
  if (!value || all.some(item => item.name.trim().toLowerCase() === value)) {
    return filtered;
  }
  const createItem = { id: 'new', name: '' } as T;
  return filtered[0]?.id === 'split'
    ? [filtered[0], createItem, ...filtered.slice(1)]
    : [createItem, ...filtered];
}

// The group to preselect for a new category: the one used last, else the
// first expense group.
export function pickDefaultGroup<G extends { id: string; is_income?: boolean }>(
  groups: G[],
  lastUsedGroupId: string | undefined,
): G | undefined {
  return (
    groups.find(g => g.id === lastUsedGroupId) ??
    groups.find(g => !g.is_income) ??
    groups[0]
  );
}
