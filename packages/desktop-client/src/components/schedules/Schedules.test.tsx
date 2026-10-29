import type { PaycheckEntity } from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { Schedules } from '.';

const state = vi.hoisted(() => ({
  paychecks: false,
  listed: [] as string[],
}));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'paychecks' ? state.paychecks : false,
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
      <Schedules />
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

  it('hides the Paychecks section when the feature is off', () => {
    renderPage();
    expect(screen.queryByText('Paychecks section')).not.toBeInTheDocument();
    expect(state.listed).toHaveLength(4);
  });
});
