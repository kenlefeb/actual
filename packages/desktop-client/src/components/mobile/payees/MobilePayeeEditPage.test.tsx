import { MemoryRouter, Route, Routes } from 'react-router';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobilePayeeEditPage } from './MobilePayeeEditPage';

// A stable list: the page reloads the payee whenever the list changes
const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  payees: { data: [{ id: 'p1', name: 'Acme' }] },
}));

vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => state.navigate }));
vi.mock('#hooks/usePayees', () => ({ usePayees: () => state.payees }));
vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: vi.fn(),
}));

function renderPage() {
  return render(
    <TestProviders>
      <MemoryRouter initialEntries={['/payees/p1']}>
        <Routes>
          <Route path="/payees/:id" element={<MobilePayeeEditPage />} />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
}

// native-appearance: "Back goes up one level in the iOS app" (sc-3736)
describe('MobilePayeeEditPage', () => {
  afterEach(() => {
    delete (window as { webkit?: unknown }).webkit;
    state.navigate.mockClear();
  });

  it('cancels with browser history in a phone browser', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(state.navigate).toHaveBeenCalledExactlyOnceWith(-1);
  });

  it('cancels up to the payees list in the iOS app', async () => {
    (window as { webkit?: unknown }).webkit = {
      messageHandlers: { actualNativeChrome: { postMessage: vi.fn() } },
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/settings/payees');
  });
});
