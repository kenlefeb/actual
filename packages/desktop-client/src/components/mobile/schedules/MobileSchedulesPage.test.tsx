import { MemoryRouter } from 'react-router';

import type { PaycheckEntity } from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobileSchedulesPage } from './MobileSchedulesPage';

const state = vi.hoisted(() => ({
  paychecks: false,
  businessCalendars: false,
  listed: [] as string[],
  navigate: vi.fn(),
}));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'paychecks'
      ? state.paychecks
      : name === 'businessCalendars'
        ? state.businessCalendars
        : false,
}));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isWideWidth: false }),
}));

vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => state.navigate }));

vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => ({
    schedules: [
      { id: 'acme-pay', name: 'Acme' },
      { id: 'acme-checking', name: 'Acme → Checking' },
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
          deposits: [{ id: 'checking', schedule: 'acme-checking' }],
        },
      } as PaycheckEntity,
    ],
  }),
}));

vi.mock('#hooks/usePayees', () => ({ usePayees: () => ({ data: [] }) }));
vi.mock('#hooks/useAccounts', () => ({ useAccounts: () => ({ data: [] }) }));

vi.mock('./SchedulesList', () => ({
  SchedulesList: ({ schedules }: { schedules: { name: string }[] }) => {
    state.listed = schedules.map(s => s.name);
    return null;
  },
}));

vi.mock('#components/schedules/PaychecksSection', () => ({
  PaychecksSection: () => <div>Paychecks section</div>,
}));

function renderPage() {
  render(
    <TestProviders>
      <MemoryRouter>
        <MobileSchedulesPage />
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('MobileSchedulesPage paychecks', () => {
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
    expect(state.listed).toHaveLength(3);
  });
});

describe('MobileSchedulesPage business calendars', () => {
  beforeEach(() => {
    state.businessCalendars = false;
    state.navigate.mockReset();
  });

  it('opens the business calendars page when the feature is on', async () => {
    state.businessCalendars = true;
    renderPage();
    await userEvent.click(
      screen.getByRole('button', { name: 'Business calendars' }),
    );
    expect(state.navigate).toHaveBeenCalledWith('/business-calendars');
  });

  it('Feature disabled: hides business calendars', () => {
    renderPage();
    expect(
      screen.queryByRole('button', { name: 'Business calendars' }),
    ).not.toBeInTheDocument();
  });
});
