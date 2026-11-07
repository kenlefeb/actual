import { describe, expect, it } from 'vitest';

import {
  addCreateSuggestion,
  filterCategorySuggestions,
  pickDefaultGroup,
} from './filterCategorySuggestions';

const savings = { name: 'Savings' };
const food = { name: 'Food' };
const bills = { name: 'Bills' };

const suggestions = [
  { id: '1', name: 'Emergency Fund', group: savings },
  { id: '2', name: 'Home Repairs', group: savings },
  { id: '3', name: 'Savings Goals', group: savings },
  { id: '4', name: 'New Car', group: savings },
  { id: '5', name: 'Holidays', group: savings },
  { id: '6', name: 'Groceries', group: food },
  { id: '7', name: 'Restaurants', group: food },
  { id: '8', name: 'Electric', group: bills },
];

function names(items: Array<{ name: string }>): string[] {
  return items.map(item => item.name);
}

describe('filterCategorySuggestions', () => {
  it('ranks category name matches above group-only matches', () => {
    const result = filterCategorySuggestions(suggestions, 'sav');

    expect(names(result)[0]).toBe('Savings Goals');
  });

  it('still includes categories whose group name matches', () => {
    const result = filterCategorySuggestions(suggestions, 'sav');

    expect(names(result)).toEqual([
      'Savings Goals',
      'Emergency Fund',
      'Home Repairs',
      'New Car',
      'Holidays',
    ]);
  });

  it('matches queries spanning group and category name', () => {
    const result = filterCategorySuggestions(suggestions, 'food gro');

    expect(names(result)).toEqual(['Groceries']);
  });

  it('matches case-insensitively', () => {
    const result = filterCategorySuggestions(suggestions, 'GROC');

    expect(names(result)).toEqual(['Groceries']);
  });

  it('returns all suggestions when the value is empty', () => {
    expect(filterCategorySuggestions(suggestions, '')).toEqual(suggestions);
  });

  it('does not fuzzy-match a query scattered across group and name', () => {
    const result = filterCategorySuggestions(
      [
        {
          id: '9',
          name: 'Local Income Tax Withholding',
          group: { name: 'Taxes & Fees' },
        },
      ],
      'Allow',
    );

    expect(result).toEqual([]);
  });

  it('treats a whitespace-only query like an empty query', () => {
    expect(filterCategorySuggestions(suggestions, '   ')).toEqual(suggestions);
  });

  it('returns no suggestions when nothing matches', () => {
    expect(filterCategorySuggestions(suggestions, 'zzz')).toEqual([]);
  });

  it('keeps the split option pinned to the top', () => {
    const withSplit = [{ id: 'split', name: '' }, ...suggestions];
    const result = filterCategorySuggestions(withSplit, 'sav');

    expect(result[0].id).toBe('split');
    expect(names(result.slice(1))[0]).toBe('Savings Goals');
  });
});

describe('addCreateSuggestion', () => {
  const filtered = (value: string) =>
    addCreateSuggestion(
      filterCategorySuggestions(suggestions, value),
      suggestions,
      value,
    );

  it('offers create when the text matches no category name', () => {
    expect(filtered('Zzzz')[0]).toMatchObject({ id: 'new' });
  });

  it('offers create alongside partial matches', () => {
    const result = filtered('Home');
    expect(result[0]).toMatchObject({ id: 'new' });
    expect(names(result)).toContain('Home Repairs');
  });

  it('does not offer create for an exact name, ignoring case and spacing', () => {
    expect(filtered('  groceries ').some(s => s.id === 'new')).toBe(false);
  });

  it('does not offer create for the exact name of a hidden category', () => {
    const allWithHidden = [...suggestions, { id: '9', name: 'Old Stuff' }];
    const result = addCreateSuggestion(
      filterCategorySuggestions(suggestions, 'old stuff'),
      allWithHidden,
      'old stuff',
    );
    expect(result.some(s => s.id === 'new')).toBe(false);
  });

  it('does not offer create for empty input', () => {
    expect(filtered('  ').some(s => s.id === 'new')).toBe(false);
  });

  it('keeps the split item first', () => {
    const withSplit = [{ id: 'split', name: '' }, ...suggestions];
    const result = addCreateSuggestion(
      filterCategorySuggestions(withSplit, 'Zzzz'),
      withSplit,
      'Zzzz',
    );
    expect(result.map(s => s.id)).toEqual(['split', 'new']);
  });
});

describe('pickDefaultGroup', () => {
  const groups = [
    { id: 'inc', name: 'Income', is_income: true },
    { id: 'bills', name: 'Bills' },
    { id: 'food', name: 'Food' },
  ];

  it('prefers the most recently used group', () => {
    expect(pickDefaultGroup(groups, 'food')?.id).toBe('food');
  });

  it('falls back to the first expense group', () => {
    expect(pickDefaultGroup(groups, undefined)?.id).toBe('bills');
    expect(pickDefaultGroup(groups, 'gone')?.id).toBe('bills');
  });

  it('returns undefined when there are no groups', () => {
    expect(pickDefaultGroup([], undefined)).toBeUndefined();
  });
});
