import React from 'react';

import type { CategoryGroupEntity } from '@actual-app/core/types/models';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpreadsheetProvider } from '#hooks/useSpreadsheet';
import { TestProviders } from '#mocks';

import { CategoryAutocomplete } from './CategoryAutocomplete';

const createCategory = vi.fn();

vi.mock('#budget/mutations', () => ({
  useCreateCategoryMutation: () => ({ mutateAsync: createCategory }),
}));

const categoryGroups = [
  {
    id: 'inc',
    name: 'Income',
    is_income: true,
    categories: [
      { id: 'pay', name: 'Paycheck', group: 'inc', is_income: true },
    ],
  },
  {
    id: 'bills',
    name: 'Bills',
    categories: [
      { id: 'elec', name: 'Electric', group: 'bills' },
      { id: 'old', name: 'Old Stuff', group: 'bills', hidden: true },
    ],
  },
  {
    id: 'fun',
    name: 'Fun',
    categories: [{ id: 'mov', name: 'Movies', group: 'fun' }],
  },
  {
    id: 'food',
    name: 'Food',
    categories: [{ id: 'groc', name: 'Groceries', group: 'food' }],
  },
] as unknown as CategoryGroupEntity[];

function renderPicker(props = {}) {
  const onSelect = vi.fn();
  render(
    <TestProviders>
      <SpreadsheetProvider>
        <CategoryAutocomplete
          embedded
          focused
          value={null}
          categoryGroups={categoryGroups}
          showBalances={false}
          allowCreate
          onSelect={onSelect}
          {...props}
        />
      </SpreadsheetProvider>
    </TestProviders>,
  );
  return { onSelect, input: screen.getByRole('textbox') };
}

describe('CategoryAutocomplete create option', () => {
  beforeEach(() => {
    createCategory.mockReset().mockResolvedValue('new-id');
  });

  it('offers to create a category when nothing matches', async () => {
    const { input } = renderPicker();
    await userEvent.type(input, 'Allowance');
    expect(
      await screen.findByTestId('create-category-button'),
    ).toHaveTextContent('Allowance');
  });

  it('does not offer create for an existing category or when disabled', async () => {
    const { input } = renderPicker();
    await userEvent.type(input, 'Electric');
    expect(screen.queryByTestId('create-category-button')).toBeNull();
  });

  it('does not offer create for the exact name of a hidden category', async () => {
    const { input } = renderPicker();
    await userEvent.type(input, 'old stuff');
    expect(screen.queryByTestId('create-category-button')).toBeNull();
  });

  it('does not offer create unless allowCreate is set', async () => {
    const { input } = renderPicker({ allowCreate: false });
    await userEvent.type(input, 'Allowance');
    expect(screen.queryByTestId('create-category-button')).toBeNull();
  });

  it('asks for a group (first expense group by default), then creates and selects', async () => {
    const { input, onSelect } = renderPicker();
    await userEvent.type(input, 'Allowance');
    await userEvent.click(await screen.findByTestId('create-category-button'));

    expect(await screen.findByTestId('Bills-category-group-item')).toBeTruthy();
    expect(screen.getByRole('textbox')).toHaveValue('Bills');

    await userEvent.click(screen.getByTestId('Food-category-group-item'));

    await waitFor(() =>
      expect(createCategory).toHaveBeenCalledWith({
        name: 'Allowance',
        groupId: 'food',
        isIncome: false,
        isHidden: false,
      }),
    );
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith('new-id', 'Allowance'),
    );
  });

  it('leaves the field the way a normal pick does, so the register cell stops editing', async () => {
    const onBlur = vi.fn();
    const onClose = vi.fn();
    const { input } = renderPicker({ inputProps: { onBlur }, onClose });
    await userEvent.type(input, 'Allowance');
    await userEvent.click(await screen.findByTestId('create-category-button'));
    await userEvent.click(
      await screen.findByTestId('Food-category-group-item'),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // the register cell closes its editor from the input's blur
    expect(onBlur).toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it('defaults to the group of the most recently chosen category', async () => {
    const { input } = renderPicker();
    await userEvent.type(input, 'Movi');
    await userEvent.click(await screen.findByTestId('Movies-category-item'));
    await userEvent.type(screen.getByRole('textbox'), 'Allowance');
    await userEvent.click(await screen.findByTestId('create-category-button'));
    expect(await screen.findByDisplayValue('Fun')).toBeTruthy();
  });

  it('marks a category created in an income group as income', async () => {
    const { input } = renderPicker();
    await userEvent.type(input, 'Bonus');
    await userEvent.click(await screen.findByTestId('create-category-button'));
    await userEvent.click(
      await screen.findByTestId('Income-category-group-item'),
    );
    await waitFor(() =>
      expect(createCategory).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'inc', isIncome: true }),
      ),
    );
  });
});
