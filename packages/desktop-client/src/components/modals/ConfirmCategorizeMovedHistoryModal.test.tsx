import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { ConfirmCategorizeMovedHistoryModal } from './ConfirmCategorizeMovedHistoryModal';

function renderModal(onConfirm: () => void) {
  render(
    <TestProviders>
      <ConfirmCategorizeMovedHistoryModal onConfirm={onConfirm} />
    </TestProviders>,
  );
}

describe('ConfirmCategorizeMovedHistoryModal', () => {
  it('explains the double count', () => {
    renderModal(vi.fn());
    expect(screen.getByText('Categorize moved history?')).toBeInTheDocument();
    expect(screen.getByText(/would count the money twice/)).toBeInTheDocument();
  });

  it('Cancel changes nothing', async () => {
    const onConfirm = vi.fn();
    renderModal(onConfirm);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Categorize anyway confirms', async () => {
    const onConfirm = vi.fn();
    renderModal(onConfirm);
    await userEvent.click(
      screen.getByRole('button', { name: 'Categorize anyway' }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
