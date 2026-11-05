import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';

import { AllAccountsMenu } from './AllAccountsMenu';

const state = vi.hoisted(() => ({ amazon: false }));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (flag: string) =>
    flag === 'amazonOrderItemization' && state.amazon,
}));

function renderMenu(onMenuSelect = vi.fn()) {
  render(
    <TestProviders>
      <AllAccountsMenu
        isSorted={false}
        showNetWorthChart={false}
        showReconciled={false}
        onMenuSelect={onMenuSelect}
      />
    </TestProviders>,
  );
  return onMenuSelect;
}

describe('all accounts menu', () => {
  beforeEach(() => {
    resetTestProviders();
    state.amazon = false;
  });

  it('Hidden when the feature is off', () => {
    renderMenu();
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.queryByText('Import Amazon orders')).not.toBeInTheDocument();
  });

  it('Offered when the feature is on', async () => {
    state.amazon = true;
    const onMenuSelect = renderMenu();

    await userEvent.click(screen.getByText('Import Amazon orders'));

    expect(onMenuSelect).toHaveBeenCalledWith('import-amazon-orders');
  });
});
