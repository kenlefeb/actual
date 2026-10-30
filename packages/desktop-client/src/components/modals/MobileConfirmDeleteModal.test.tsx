import { theme } from '@actual-app/components/theme';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobileConfirmDeleteModal } from './MobileConfirmDeleteModal';

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true }),
}));

function renderSheet() {
  const onConfirm = vi.fn();
  render(
    <TestProviders>
      <MobileConfirmDeleteModal
        title="Delete paycheck"
        message="Delete the paycheck?"
        onConfirm={onConfirm}
      />
    </TestProviders>,
  );
  return onConfirm;
}

describe('MobileConfirmDeleteModal', () => {
  it('shows the message with a red, touch-sized Delete', () => {
    renderSheet();
    expect(screen.getByText('Delete the paycheck?')).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'Delete' });
    expect(remove).toHaveStyle({
      backgroundColor: theme.errorText,
      height: '40px',
    });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveStyle({
      height: '40px',
    });
  });

  it('deletes only when Delete is tapped', async () => {
    const onConfirm = renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();

    const again = renderSheet();
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Delete' }).at(-1)!,
    );
    expect(again).toHaveBeenCalledTimes(1);
  });
});
