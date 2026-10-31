import { MemoryRouter, Route, Routes } from 'react-router';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';
import type * as ModalsSlice from '#modals/modalsSlice';

import { MobileRuleEditPage } from './MobileRuleEditPage';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  send: vi.fn(),
  pushModal: vi.fn(),
}));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isWideWidth: false }),
}));
vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: state.send,
  listen: () => vi.fn(),
}));
vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => state.navigate }));
vi.mock('#hooks/useSchedules', () => ({ useSchedules: () => ({}) }));
vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: () => Promise.resolve({ data: [] }),
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
// The editor's field inputs load data of their own
vi.mock('#components/util/GenericInput', () => ({ GenericInput: () => null }));

const existingRule = {
  id: 'rule-1',
  stage: null,
  conditionsOp: 'and',
  conditions: [{ field: 'payee', op: 'is', value: 'p1', type: 'id' }],
  actions: [{ field: 'category', op: 'set', value: 'c1', type: 'id' }],
};

function renderPage(path: string) {
  return render(
    <TestProviders>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/rules/:id" element={<MobileRuleEditPage />} />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('MobileRuleEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.send.mockImplementation((name: string) => {
      switch (name) {
        case 'rule-get':
          return Promise.resolve(existingRule);
        case 'rule-add':
          return Promise.resolve({ id: 'new-rule' });
        case 'make-filters-from-conditions':
          return Promise.resolve({ filters: [] });
        default:
          return Promise.resolve({});
      }
    });
  });

  it('saves from the footer and has no Cancel button', async () => {
    renderPage('/rules/new');
    const user = userEvent.setup();

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(state.send).toHaveBeenCalledWith(
        'rule-add',
        expect.objectContaining({ conditionsOp: 'and' }),
      ),
    );
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
  });

  it('cancels with the back arrow without saving', async () => {
    renderPage('/rules/new');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(state.navigate).toHaveBeenCalledWith(-1);
    expect(state.send).not.toHaveBeenCalledWith('rule-add', expect.anything());
  });

  it('keeps Delete in the body behind a confirmation, and Apply actions too', async () => {
    renderPage('/rules/rule-1');
    const user = userEvent.setup();

    const del = await screen.findByRole('button', { name: 'Delete' });
    const footer = screen.getByRole('button', { name: 'Save' }).parentElement;
    expect(footer?.contains(del)).toBe(false);
    expect(screen.getByRole('button', { name: /Apply actions/ })).toBeTruthy();

    await user.click(del);
    expect(state.pushModal).toHaveBeenCalledWith(
      expect.objectContaining({
        modal: expect.objectContaining({ name: 'confirm-delete' }),
      }),
    );
    expect(state.send).not.toHaveBeenCalledWith('rule-delete', 'rule-1');
  });
});
