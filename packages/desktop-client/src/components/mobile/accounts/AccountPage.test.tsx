import { MemoryRouter, Route, Routes } from 'react-router';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { AccountPage } from './AccountPage';

const state = vi.hoisted(() => ({
  account: { id: 'checking', name: 'Checking', closed: false },
  pushModal: vi.fn(),
}));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isWideWidth: false }),
}));
vi.mock('#hooks/useAccount', () => ({ useAccount: () => state.account }));
vi.mock('#accounts', () => ({
  useUpdateAccountMutation: () => ({ mutate: vi.fn() }),
  useReopenAccountMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('#components/mobile/transactions/AddTransactionButton', () => ({
  AddTransactionButton: () => null,
}));
vi.mock('./AccountTransactions', () => ({ AccountTransactions: () => null }));
vi.mock('#modals/modalsSlice', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  pushModal: (payload: unknown) => {
    state.pushModal(payload);
    return { type: 'test/pushModal' };
  },
}));

describe('AccountPage', () => {
  it('lets the account menu open Business days for the account', async () => {
    render(
      <TestProviders>
        <MemoryRouter initialEntries={['/accounts/checking']}>
          <Routes>
            <Route path="/accounts/:id" element={<AccountPage />} />
          </Routes>
        </MemoryRouter>
      </TestProviders>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Checking' }));
    const [{ modal: menu }] = state.pushModal.mock.lastCall ?? [];
    expect(menu.name).toBe('account-menu');
    expect(menu.options.onEditBusinessDays).toBeInstanceOf(Function);

    menu.options.onEditBusinessDays('checking');
    expect(state.pushModal).toHaveBeenLastCalledWith({
      modal: {
        name: 'account-business-days',
        options: { accountId: 'checking' },
      },
    });
  });
});
