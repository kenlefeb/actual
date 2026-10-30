import { MemoryRouter } from 'react-router';

import type { PaycheckEntity } from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { Schedules } from '.';

const state = vi.hoisted(() => ({
  paychecks: false,
  businessCalendars: false,
  listed: [] as string[],
}));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'paychecks'
      ? state.paychecks
      : name === 'businessCalendars'
        ? state.businessCalendars
        : false,
}));

vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => ({
    schedules: [
      { id: 'acme-pay', name: 'Acme' },
      { id: 'acme-checking', name: 'Acme → Checking' },
      { id: 'acme-savings', name: 'Acme → Savings' },
      { id: 'rent', name: 'Rent' },
    ],
    statuses: new Map(),
    isLoading: false,
  }),
}));

vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({
    data: [
      {
        id: 'acme',
        name: 'Acme',
        definition: {
          clearingAccount: 'clearing',
          paySchedule: 'acme-pay',
          deposits: [
            { id: 'checking', schedule: 'acme-checking' },
            { id: 'savings', schedule: 'acme-savings' },
          ],
        },
      } as PaycheckEntity,
    ],
  }),
}));

vi.mock('./SchedulesTable', () => ({
  SchedulesTable: ({ schedules }: { schedules: { name: string }[] }) => {
    state.listed = schedules.map(s => s.name);
    return null;
  },
}));

vi.mock('./PaychecksSection', () => ({
  PaychecksSection: () => <div>Paychecks section</div>,
}));

function renderPage() {
  render(
    <TestProviders>
      <MemoryRouter>
        <Schedules />
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('Schedules page paychecks', () => {
  beforeEach(() => {
    state.paychecks = false;
  });

  it('shows the Paychecks section and lists paycheck schedules once', () => {
    state.paychecks = true;
    renderPage();
    expect(screen.getByText('Paychecks section')).toBeInTheDocument();
    expect(state.listed).toEqual(['Rent']);
  });

  // paychecks spec, "No Delete for a paycheck's schedules": the table's row
  // menu is the only Delete on desktop, and it never gets a paycheck's schedule
  it('Delete a deposit schedule from Schedules: no table row, so no Delete', () => {
    state.paychecks = true;
    renderPage();
    expect(state.listed).not.toContain('Acme → Checking');
  });

  it('hides the Paychecks section when the feature is off', () => {
    renderPage();
    expect(screen.queryByText('Paychecks section')).not.toBeInTheDocument();
    expect(state.listed).toHaveLength(4);
  });
});

describe('Schedules page business calendars', () => {
  beforeEach(() => {
    state.businessCalendars = false;
  });

  it('shows the Business calendars button when the feature is on', () => {
    state.businessCalendars = true;
    renderPage();
    expect(
      screen.getByRole('button', { name: 'Business calendars' }),
    ).toBeInTheDocument();
  });

  it('Feature disabled: hides the Business calendars button', () => {
    renderPage();
    expect(
      screen.queryByRole('button', { name: 'Business calendars' }),
    ).not.toBeInTheDocument();
  });
});
