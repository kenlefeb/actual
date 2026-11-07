import React, { useState } from 'react';

import type { CategoryGroupEntity } from '@actual-app/core/types/models';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomCell } from '#components/table';
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

// The register's category cell: CustomCell wraps the picker exactly like
// TransactionsTable does, and the groups/value refresh like the live data.
function RegisterCell({ onCellUpdate }: { onCellUpdate: (v: string) => void }) {
  const [groups, setGroups] = useState(categoryGroups);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  createCategory.mockImplementation(async ({ name, groupId }) => {
    // like the live app, the category list refreshes after the new id has
    // already reached the cell
    setTimeout(
      () =>
        setGroups(current =>
          current.map(g =>
            g.id === groupId
              ? ({
                  ...g,
                  categories: [
                    ...(g.categories ?? []),
                    { id: 'new-id', name, group: groupId },
                  ],
                } as CategoryGroupEntity)
              : g,
          ),
        ),
      30,
    );
    return 'new-id';
  });

  return (
    <CustomCell
      name="category"
      width="flex"
      value={categoryId ?? undefined}
      exposed
      onUpdate={value => {
        onCellUpdate(value);
        setCategoryId(value);
      }}
    >
      {({ onBlur, onKeyDown, onUpdate, onSave, shouldSaveFromKey }) => (
        <CategoryAutocomplete
          categoryGroups={groups}
          value={categoryId}
          focused
          clearOnBlur={false}
          showBalances={false}
          allowCreate
          shouldSaveFromKey={shouldSaveFromKey}
          inputProps={{ onBlur, onKeyDown }}
          onUpdate={onUpdate}
          onSelect={onSave}
        />
      )}
    </CustomCell>
  );
}

describe('creating a category in the register cell', () => {
  beforeEach(() => {
    createCategory.mockReset();
  });

  function renderCell() {
    const onCellUpdate = vi.fn();
    render(
      <TestProviders>
        <SpreadsheetProvider>
          <RegisterCell onCellUpdate={onCellUpdate} />
        </SpreadsheetProvider>
      </TestProviders>,
    );
    return { onCellUpdate, input: screen.getByRole('textbox') };
  }

  it('commits the new category id, and leaving the cell does not overwrite it (mouse)', async () => {
    const { onCellUpdate, input } = renderCell();
    await userEvent.type(input, 'Allowance');
    await userEvent.click(await screen.findByTestId('create-category-button'));
    await userEvent.click(
      await screen.findByTestId('Food-category-group-item'),
    );

    await waitFor(() => expect(onCellUpdate).toHaveBeenCalledWith('new-id'));
    // back on the plain picker, showing the new category's name
    expect(await screen.findByDisplayValue('Allowance')).toBeTruthy();

    await userEvent.click(document.body); // leave the cell
    expect(onCellUpdate).not.toHaveBeenCalledWith('new');
    expect(onCellUpdate).toHaveBeenLastCalledWith('new-id');
    expect(onCellUpdate).toHaveBeenCalledTimes(1);
  });

  it('creates in the default group with Enter, Enter (keyboard)', async () => {
    const { onCellUpdate, input } = renderCell();
    await userEvent.type(input, 'Allowance');
    await userEvent.keyboard('{Enter}'); // the Create row
    // the preselected group (module state remembers earlier tests' picks)
    const preselected = (
      (
        await screen.findByText(/Group for new category/)
      ).parentElement!.querySelector('input') as HTMLInputElement
    ).value;
    await userEvent.keyboard('{Enter}'); // accept the default group

    await waitFor(() =>
      expect(createCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Allowance',
          groupId: preselected.toLowerCase(),
        }),
      ),
    );
    await waitFor(() => expect(onCellUpdate).toHaveBeenCalledWith('new-id'));
    expect(onCellUpdate).not.toHaveBeenCalledWith('new');
    expect(await screen.findByDisplayValue('Allowance')).toBeTruthy();
  });
});
