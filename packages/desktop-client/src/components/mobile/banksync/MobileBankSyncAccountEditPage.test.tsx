import { MemoryRouter, Route, Routes } from 'react-router';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';
import type * as ModalsSlice from '#modals/modalsSlice';

import { MobileBankSyncAccountEditPage } from './MobileBankSyncAccountEditPage';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  saveSettings: vi.fn(),
  unlink: vi.fn(),
  pushModal: vi.fn(),
}));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isWideWidth: false }),
}));
vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => state.navigate }));
vi.mock('#hooks/useAccount', () => ({
  useAccount: () => ({ id: 'acc', name: 'Checking' }),
}));
vi.mock('#accounts', () => ({
  useUnlinkAccountMutation: () => ({ mutate: state.unlink }),
}));
vi.mock('#components/banksync/useBankSyncAccountSettings', () => ({
  useBankSyncAccountSettings: () => ({
    transactionDirection: 'payment',
    setTransactionDirection: vi.fn(),
    mappings: new Map(),
    setMapping: vi.fn(),
    fields: [],
    saveSettings: state.saveSettings,
  }),
}));
vi.mock('#components/banksync/FieldMapping', () => ({
  FieldMapping: () => null,
}));
vi.mock('#components/banksync/BankSyncCheckboxOptions', () => ({
  BankSyncCheckboxOptions: () => null,
}));
vi.mock('#modals/modalsSlice', async importOriginal => {
  const actual = await importOriginal<typeof ModalsSlice>();
  return {
    ...actual,
    pushModal: (payload: Parameters<typeof actual.pushModal>[0]) => {
      state.pushModal(payload);
      return actual.pushModal(payload);
    },
  };
});

function renderPage() {
  return render(
    <TestProviders>
      <MemoryRouter initialEntries={['/settings/bank-sync/acc']}>
        <Routes>
          <Route
            path="/settings/bank-sync/:accountId"
            element={<MobileBankSyncAccountEditPage />}
          />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('MobileBankSyncAccountEditPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves from the footer and returns to the list', async () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(state.saveSettings).toHaveBeenCalledTimes(1);
    expect(state.navigate).toHaveBeenCalledWith('/settings/bank-sync');
  });

  it('cancels with the back arrow without saving', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(state.saveSettings).not.toHaveBeenCalled();
    expect(state.navigate).toHaveBeenCalledWith('/settings/bank-sync');
  });

  it('puts Unlink in the body, behind a confirmation', async () => {
    renderPage();
    const unlink = screen.getByRole('button', { name: 'Unlink account' });
    const footer = screen.getByRole('button', { name: 'Save' }).parentElement;
    expect(footer?.contains(unlink)).toBe(false);

    await userEvent.click(unlink);

    expect(state.pushModal).toHaveBeenCalledWith(
      expect.objectContaining({
        modal: expect.objectContaining({ name: 'confirm-unlink-account' }),
      }),
    );
    expect(state.unlink).not.toHaveBeenCalled();
  });
});
