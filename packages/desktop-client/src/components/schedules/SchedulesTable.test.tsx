import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { SchedulesTable } from './SchedulesTable';

const state = vi.hoisted(() => ({ isNarrowWidth: true }));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({
    isNarrowWidth: state.isNarrowWidth,
    isWideWidth: !state.isNarrowWidth,
  }),
}));

vi.mock('#hooks/useScheduleDateLookup', () => ({
  useScheduleDateLookup: () => ({ schedules: [], isLoading: false }),
}));

vi.mock('#hooks/usePayees', () => ({
  usePayees: () => ({ data: [{ id: 'p1', name: 'Acme Corp' }] }),
}));

vi.mock('#hooks/usePayee', () => ({
  usePayee: () => ({ data: { id: 'p1', name: 'Acme Corp' } }),
}));

vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({ data: [{ id: 'a1', name: 'Joint Checking' }] }),
}));

vi.mock('#hooks/useAccount', () => ({
  useAccount: () => ({ id: 'a1', name: 'Joint Checking' }),
}));

const schedules = [
  {
    id: 's1',
    name: 'Payroll deposit',
    _payee: 'p1',
    _account: 'a1',
    _amount: 187711,
    _amountOp: 'is',
    _date: '2026-11-13',
    next_date: '2026-11-13',
    completed: false,
  },
] as never;

function renderTable() {
  render(
    <TestProviders>
      <SchedulesTable
        schedules={schedules}
        statuses={new Map([['s1', 'due']])}
        filter=""
        allowCompleted={false}
        minimal
        onSelect={vi.fn()}
        style={{}}
      />
    </TestProviders>,
  );
}

describe('SchedulesTable in the minimal (link) dialog', () => {
  it('stacks the name, payee and account on a phone-width screen', () => {
    state.isNarrowWidth = true;
    renderTable();
    expect(screen.getByText('Payroll deposit')).toBeInTheDocument();
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText(/Joint Checking/)).toBeInTheDocument();
    // The wide column headers are replaced by the stacked row
    expect(screen.queryByText('Payee')).not.toBeInTheDocument();
  });

  it('keeps the column layout on desktop', () => {
    state.isNarrowWidth = false;
    renderTable();
    expect(screen.getByText('Payee')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });
});
