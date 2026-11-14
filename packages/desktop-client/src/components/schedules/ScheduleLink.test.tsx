import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { ScheduleLink } from './ScheduleLink';

const state = vi.hoisted(() => ({ isNarrowWidth: true }));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({
    isNarrowWidth: state.isNarrowWidth,
    isWideWidth: !state.isNarrowWidth,
  }),
}));

vi.mock('#components/common/Modal', () => ({
  Modal: ({ children }: { children: (a: { state: unknown }) => never }) =>
    children({ state: { close: vi.fn() } }),
  ModalHeader: () => null,
  ModalCloseButton: () => null,
}));

vi.mock('#components/common/Search', async () => {
  const { forwardRef } = await import('react');
  return {
    Search: forwardRef<HTMLInputElement, { width: number | string }>(
      ({ width }, ref) => (
        <input ref={ref} data-testid="search" data-width={String(width)} />
      ),
    ),
  };
});

vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => ({
    schedules: [],
    statuses: new Map(),
    isLoading: false,
  }),
}));

vi.mock('./SchedulesTable', () => ({
  ROW_HEIGHT: 43,
  NARROW_ROW_HEIGHT: 76,
  SchedulesTable: () => null,
}));

function renderLink() {
  render(
    <TestProviders>
      <ScheduleLink
        transactionIds={['t1']}
        getTransaction={vi.fn()}
        accountName=""
      />
    </TestProviders>,
  );
}

describe('ScheduleLink header', () => {
  it('makes the search full width and stacks the header on a phone', () => {
    state.isNarrowWidth = true;
    renderLink();
    const search = screen.getByTestId('search');
    expect(search).toHaveAttribute('data-width', '100%');
    expect(search.parentElement).toHaveStyle({
      flexDirection: 'column',
    });
  });

  it('keeps the 300px search in a row on desktop', () => {
    state.isNarrowWidth = false;
    renderLink();
    const search = screen.getByTestId('search');
    expect(search).toHaveAttribute('data-width', '300');
    expect(search.parentElement).toHaveStyle({
      flexDirection: 'row',
    });
  });
});
