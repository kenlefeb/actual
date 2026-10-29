import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';
import { setScheduleDates } from '@actual-app/core/shared/schedule-date-lookup';
import type {
  AccountEntity,
  PaycheckClearingStatus,
  PaycheckEntity,
  RecurConfig,
  ScheduleEntity,
} from '@actual-app/core/types/models';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';

import { PaychecksSection } from './PaychecksSection';

const state = vi.hoisted(() => ({
  paychecks: [] as PaycheckEntity[],
  schedules: [] as Partial<ScheduleEntity>[],
  clearing: [] as PaycheckClearingStatus[],
  skip: vi.fn(),
  pushModal: vi.fn(),
}));

// Tests otherwise pin today to 2017-01-01
vi.mock('@actual-app/core/shared/months', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  currentDay: () => '2026-11-02',
}));

vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({ data: state.paychecks }),
}));

// The test fills the date lookup itself, as the real hook would
vi.mock('#hooks/useScheduleDateLookup', () => ({
  useScheduleDateLookup: () => ({
    schedules: state.schedules,
    isLoading: false,
  }),
}));

vi.mock('#hooks/useBusinessCalendarLookup', () => ({
  useBusinessCalendarLookup: () => [],
}));

vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: [
      { id: 'checking', name: 'Checking' },
      { id: 'savings', name: 'Savings' },
      { id: 'clearing', name: 'Acme Paycheck' },
    ] as Partial<AccountEntity>[],
  }),
}));

vi.mock('#paychecks', () => ({
  useSkipNextPaycheckMutation: () => ({ mutate: state.skip }),
  paycheckQueries: {
    clearingStatus: () => ({
      queryKey: ['clearing-status'],
      queryFn: async () => state.clearing,
    }),
  },
}));

vi.mock('#modals/modalsSlice', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  pushModal: (payload: unknown) => {
    state.pushModal(payload);
    return { type: 'test/pushModal' };
  },
}));

const payDate: RecurConfig = {
  start: '2026-01-01',
  frequency: 'monthly',
  interval: 1,
  patterns: [
    { type: 'day', value: 15 },
    { type: 'day', value: -1 },
  ],
  skipWeekend: true,
  weekendSolveMode: 'before',
  endMode: 'never',
};

const acme = {
  id: 'acme',
  name: 'Acme',
  definition: {
    payee: null,
    clearingAccount: 'clearing',
    date: payDate,
    weekendSolveMode: 'before',
    grossAmount: 300000,
    incomeCategory: null,
    deductions: [{ id: 'tax', name: 'Tax', amount: 75000 }],
    deposits: [
      {
        id: 'checking',
        account: 'checking',
        kind: 'remainder',
        value: 0,
        schedule: 'acme-checking',
      },
      {
        id: 'savings',
        account: 'savings',
        kind: 'percent',
        value: 10,
        schedule: 'acme-savings',
      },
    ],
    paySchedule: 'acme-pay',
  },
} satisfies PaycheckEntity;

function deposit(id: string, offset: number) {
  return {
    id,
    next_date: '2026-11-13',
    completed: false,
    _date: {
      relativeTo: {
        scheduleId: 'acme-pay',
        offset,
        unit: 'business-days',
        direction: 'before',
      },
      businessCalendarId: 'fed',
    },
  } satisfies Partial<ScheduleEntity>;
}

function fillScheduleDates() {
  setScheduleDates(
    state.schedules.flatMap(s =>
      s.id && s._date ? [[s.id, s._date] as const] : [],
    ),
  );
}

function withPayNextDate(next_date: string) {
  state.schedules = [
    { id: 'acme-pay', next_date, completed: false, _date: payDate },
    deposit('acme-checking', 2),
    deposit('acme-savings', 0),
  ];
  fillScheduleDates();
}

function renderSection() {
  render(
    <TestProviders>
      <PaychecksSection />
    </TestProviders>,
  );
}

describe('PaychecksSection', () => {
  beforeEach(() => {
    setBusinessCalendars([
      {
        id: 'fed',
        name: 'U.S. Federal Reserve',
        nonWorkingDays: [0, 6],
        holidays: [
          {
            id: 'veterans',
            name: 'Veterans Day',
            kind: 'fixed',
            month: 11,
            day: 11,
            observance: 'nearest-weekday',
          },
          {
            id: 'thanksgiving',
            name: 'Thanksgiving Day',
            kind: 'nth-weekday',
            month: 11,
            weekday: 4,
            nth: 4,
            observance: 'none',
          },
        ],
        exceptions: [],
      },
    ]);
    resetTestProviders();
    state.paychecks = [acme];
    state.clearing = [];
    withPayNextDate('2026-11-13');
    state.skip.mockReset();
    state.pushModal.mockReset();
  });

  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
  });

  it('shows the next paycheck at a glance', () => {
    renderSection();
    const row = screen.getByRole('button', { name: 'Edit paycheck Acme' });
    expect(row).toHaveTextContent('Friday, November 13, 2026');
    expect(row).toHaveTextContent('2,250.00');
    expect(row).toHaveTextContent('Checking · 2,025.00 · Tuesday, November 10');
    expect(row).toHaveTextContent('Savings · 225.00 · Friday, November 13');
  });

  it('orders rows by next pay date', () => {
    state.paychecks = [
      {
        ...acme,
        id: 'later',
        name: 'Later',
        definition: { ...acme.definition, paySchedule: 'later-pay' },
      },
      acme,
    ];
    state.schedules.push({
      id: 'later-pay',
      next_date: '2026-11-30',
      completed: false,
      _date: payDate,
    });
    fillScheduleDates();
    renderSection();
    expect(
      screen
        .getAllByRole('button', { name: /^Edit paycheck/ })
        .map(b => b.getAttribute('aria-label')),
    ).toEqual(['Edit paycheck Acme', 'Edit paycheck Later']);
  });

  it('opens the editor from a row', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(
      screen.getByRole('button', { name: 'Edit paycheck Acme' }),
    );
    expect(state.pushModal).toHaveBeenCalledWith({
      modal: { name: 'paycheck-edit', options: { paycheckId: 'acme' } },
    });
  });

  it('shows the next three paychecks with their deposits on "Show more"', async () => {
    const user = userEvent.setup();
    renderSection();
    const section = screen.getByRole('region', { name: 'Paychecks' });
    expect(section).not.toHaveTextContent('November 30, 2026');

    await user.click(screen.getByRole('button', { name: 'Show more' }));

    expect(section).toHaveTextContent('Monday, November 30, 2026');
    expect(section).toHaveTextContent('Tuesday, December 15, 2026');
    expect(section).toHaveTextContent('Thursday, December 31, 2026');
    expect(section).toHaveTextContent(
      'Checking · 2,025.00 · Wednesday, November 25',
    );
    expect(section).toHaveTextContent(
      'Savings · 225.00 · Thursday, December 31',
    );
  });

  it('confirms before skipping the next paycheck', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(
      screen.getByRole('button', { name: 'Skip next paycheck' }),
    );
    expect(
      screen.getByText('Skip the paycheck on November 13, 2026?'),
    ).toBeInTheDocument();
    expect(state.skip).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Skip it' }));
    expect(state.skip).toHaveBeenCalledWith({ id: 'acme' }, expect.anything());
  });

  it('keeps the paycheck when the skip is not confirmed', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(
      screen.getByRole('button', { name: 'Skip next paycheck' }),
    );
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(state.skip).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Skip next paycheck' }),
    ).toBeInTheDocument();
  });

  it('shows a skipped paycheck, and the next one after it', () => {
    withPayNextDate('2026-11-30');
    renderSection();
    const section = screen.getByRole('region', { name: 'Paychecks' });
    expect(section).toHaveTextContent('Skipped: Friday, November 13');
    expect(
      screen.getByRole('button', { name: 'Edit paycheck Acme' }),
    ).toHaveTextContent('Monday, November 30, 2026');
  });

  it('shows the skipped paycheck again once undo restores it', () => {
    withPayNextDate('2026-11-30');
    const { rerender } = render(
      <TestProviders>
        <PaychecksSection />
      </TestProviders>,
    );
    // Undo puts the pay schedule's next date back
    withPayNextDate('2026-11-13');
    rerender(
      <TestProviders>
        <PaychecksSection />
      </TestProviders>,
    );
    const section = screen.getByRole('region', { name: 'Paychecks' });
    expect(section).not.toHaveTextContent('Skipped');
    expect(
      within(section).getByRole('button', { name: 'Edit paycheck Acme' }),
    ).toHaveTextContent('Friday, November 13, 2026');
  });

  it('warns on the row about a missing deposit', async () => {
    state.clearing = [
      {
        paycheck: 'acme',
        clearingAccount: 'clearing',
        balance: 202500,
        payDate: '2026-11-13',
        missingDeposits: [
          { id: 'checking', account: 'checking', expectedDate: '2026-11-10' },
        ],
        isWarning: true,
      },
    ];
    renderSection();
    const section = screen.getByRole('region', { name: 'Paychecks' });
    await waitFor(() =>
      expect(section).toHaveTextContent(
        '2,025.00 is still in "Acme Paycheck", waiting on the deposit to Checking.',
      ),
    );
  });

  it('does not warn on the row while deposits may still arrive', async () => {
    state.clearing = [
      {
        paycheck: 'acme',
        clearingAccount: 'clearing',
        balance: 225000,
        payDate: '2026-11-30',
        missingDeposits: [
          { id: 'checking', account: 'checking', expectedDate: '2026-11-25' },
        ],
        isWarning: false,
      },
    ];
    renderSection();
    // Let the status query settle before checking nothing rendered
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(
      screen.getByRole('region', { name: 'Paychecks' }),
    ).not.toHaveTextContent('is still in');
  });

  it('offers to set up the first paycheck', async () => {
    const user = userEvent.setup();
    state.paychecks = [];
    renderSection();
    expect(
      screen.getByText(
        'Set up a paycheck to see what lands in each account, and when.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add paycheck' }));
    expect(state.pushModal).toHaveBeenCalledWith({
      modal: { name: 'paycheck-edit', options: {} },
    });
  });
});
