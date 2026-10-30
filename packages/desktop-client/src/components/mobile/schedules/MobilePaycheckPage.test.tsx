import { MemoryRouter, Route, Routes } from 'react-router';

import { theme } from '@actual-app/components/theme';
import type { PaycheckEntity } from '@actual-app/core/types/models';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaycheckEditModal } from '#components/modals/PaycheckEditModal/PaycheckEditModal';
import { useOpenPaycheck } from '#components/schedules/PaycheckRow';
import { TestProviders } from '#mocks';

import { MobilePaycheckPage } from './MobilePaycheckPage';

const state = vi.hoisted(() => ({
  paychecks: [] as PaycheckEntity[],
  saveAsync: vi.fn(),
  mutate: vi.fn(),
  navigate: vi.fn(),
  isNarrowWidth: true,
}));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({
    isNarrowWidth: state.isNarrowWidth,
    isWideWidth: !state.isNarrowWidth,
  }),
}));

vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => state.navigate }));

vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: [
      { id: 'checking', name: 'Checking' },
      { id: 'savings', name: 'Savings' },
    ],
  }),
}));

vi.mock('#hooks/usePayees', () => ({
  usePayeesById: () => ({ data: { acme: { id: 'acme', name: 'Acme' } } }),
}));

vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({ data: state.paychecks, isPlaceholderData: false }),
}));

vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => ({ schedules: [{ next_date: '2026-11-13' }] }),
}));

vi.mock('#paychecks', () => ({
  useSavePaycheckMutation: () => ({ mutateAsync: state.saveAsync }),
  useDeletePaycheckMutation: () => ({ mutate: state.mutate }),
  useSkipNextPaycheckMutation: () => ({ mutate: state.mutate }),
  useSetAccountBusinessDaysMutation: () => ({ mutateAsync: vi.fn() }),
  paycheckQueries: {
    yearToDate: (id: string) => ({
      queryKey: ['year-to-date', id],
      queryFn: () => [],
    }),
  },
}));

// Autocompletes load data of their own; a plain input stands in for picking an id
vi.mock('#components/util/GenericInput', () => ({
  GenericInput: ({
    value,
    onChange,
    placeholder,
    'aria-label': label,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    'aria-label'?: string;
  }) => (
    <input
      aria-label={label}
      value={value}
      placeholder={placeholder ?? 'nothing'}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));
vi.mock('#components/select/RecurringSchedulePicker', () => ({
  RecurringSchedulePicker: () => null,
}));

const acme = {
  id: 'acme',
  name: 'Acme',
  definition: {
    payee: 'acme',
    clearingAccount: 'clearing',
    date: { start: '2026-11-01', frequency: 'monthly' },
    weekendSolveMode: 'before',
    grossAmount: 300000,
    incomeCategory: 'income',
    deductions: [
      { id: 'tax', name: 'Federal tax', amount: 45000, category: 'taxes' },
    ],
    deposits: [
      { id: 'savings', account: 'savings', kind: 'percent', value: 10 },
      { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
    ],
  },
} satisfies PaycheckEntity;

function renderPage(id: string) {
  return render(
    <TestProviders>
      <MemoryRouter initialEntries={[`/paychecks/${id}`]}>
        <Routes>
          <Route path="/paychecks/:id" element={<MobilePaycheckPage />} />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
}

// The same steps on either layout
async function setUpAcme() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Name'), 'Acme');
  await user.type(screen.getByLabelText('Employer'), 'acme');
  await user.type(screen.getByLabelText('Gross pay'), '3000{Enter}');
  await user.type(screen.getByLabelText('Deposit 1 account'), 'checking');
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

function savedPayload() {
  const [payload] = state.saveAsync.mock.lastCall ?? [];
  // Deposit ids are new for every form
  return {
    ...payload,
    definition: {
      ...payload.definition,
      deposits: payload.definition.deposits.map(
        (d: Record<string, unknown>) => ({ ...d, id: 'deposit' }),
      ),
    },
  };
}

describe('MobilePaycheckPage', () => {
  beforeEach(() => {
    state.paychecks = [];
    state.saveAsync.mockReset().mockResolvedValue(undefined);
    state.navigate.mockReset();
    state.isNarrowWidth = true;
  });

  it('sets up a paycheck on a phone with the same save as desktop', async () => {
    renderPage('new');
    await setUpAcme();
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith(-1));
    const mobile = savedPayload();
    expect(mobile).toMatchObject({
      name: 'Acme',
      newClearingAccountName: 'Acme Paycheck',
      definition: {
        payee: 'acme',
        clearingAccount: '',
        grossAmount: 300000,
        deposits: [{ account: 'checking', kind: 'remainder' }],
      },
    });

    document.body.innerHTML = '';
    render(
      <TestProviders>
        <PaycheckEditModal />
      </TestProviders>,
    );
    await setUpAcme();
    await waitFor(() => expect(state.saveAsync).toHaveBeenCalledTimes(2));
    expect(savedPayload()).toEqual(mobile);
  });

  it('keeps net pay visible and current while deductions change', async () => {
    const user = userEvent.setup();
    state.paychecks = [acme];
    renderPage('acme');

    // An existing paycheck opens as one-line summaries
    const deposits = screen.getByRole('button', { name: /^Direct deposits/ });
    expect(deposits).toHaveAttribute('aria-expanded', 'false');
    expect(deposits).toHaveTextContent('Savings 255.00, Checking 2,295.00');
    expect(screen.getByText('Net pay:').parentElement).toHaveTextContent(
      '2,550.00',
    );

    await user.click(screen.getByRole('button', { name: /^Deductions/ }));
    const amount = screen.getByLabelText('Deduction 1 amount');
    await user.clear(amount);
    await user.type(amount, '500{Enter}');
    expect(screen.getByText('Net pay:').parentElement).toHaveTextContent(
      '2,500.00',
    );
    expect(deposits).toHaveTextContent('Savings 250.00, Checking 2,250.00');

    await user.click(screen.getByRole('button', { name: 'Add deduction' }));
    await user.type(screen.getByLabelText('Deduction 2 amount'), '100{Enter}');
    expect(screen.getByText('Net pay:').parentElement).toHaveTextContent(
      '2,400.00',
    );
  });

  it('offers skipping and deleting an existing paycheck', async () => {
    const user = userEvent.setup();
    state.paychecks = [acme];
    state.mutate.mockReset();
    renderPage('acme');
    expect(
      screen.getByRole('button', { name: 'Delete paycheck' }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Skip next paycheck' }),
    );
    await user.click(screen.getByRole('button', { name: 'Skip it' }));
    expect(state.mutate).toHaveBeenCalledWith(
      { id: 'acme' },
      expect.anything(),
    );
  });

  it('counts one deduction in the singular', () => {
    state.paychecks = [acme];
    renderPage('acme');
    expect(
      screen.getByRole('button', { name: /^Deductions/ }),
    ).toHaveTextContent('1 deduction · 450.00');
  });

  it('gives the editor controls 40px touch targets', async () => {
    const user = userEvent.setup();
    state.paychecks = [acme];
    renderPage('acme');
    await user.click(screen.getByRole('button', { name: /^Deductions/ }));
    await user.click(screen.getByRole('button', { name: /^Direct deposits/ }));
    await user.click(screen.getByRole('button', { name: /^Details/ }));
    await user.click(screen.getByRole('button', { name: /^Gross pay/ }));
    const touchTarget = { minHeight: '40px', minWidth: '40px' };
    for (const control of [
      screen.getByRole('button', { name: 'Remove deduction 1' }),
      screen.getByRole('button', { name: 'Remove deposit 1' }),
      screen.getByRole('button', { name: 'Add deduction' }),
      screen.getByRole('button', { name: 'Add deposit' }),
      screen.getByRole('button', { name: 'Delete paycheck' }),
      screen.getByRole('button', { name: 'Skip next paycheck' }),
      screen.getByLabelText('Name'),
      screen.getByLabelText('Gross pay'),
      screen.getByLabelText('Deduction 1 amount'),
      screen.getByLabelText('Deposit 1 amount type'),
    ]) {
      expect(control).toHaveStyle(touchTarget);
    }
  });

  it('stacks each deduction and deposit field full width on a phone', async () => {
    const user = userEvent.setup();
    state.paychecks = [
      {
        ...acme,
        definition: {
          ...acme.definition,
          deposits: [
            { id: 'savings', account: 'savings', kind: 'fixed', value: 10000 },
            ...acme.definition.deposits.slice(1),
          ],
        },
      },
    ];
    renderPage('acme');
    await user.click(screen.getByRole('button', { name: /^Deductions/ }));
    await user.click(screen.getByRole('button', { name: /^Direct deposits/ }));
    // jsdom does no layout, so this checks the styles that stack the fields
    const fullWidth = { width: '100%', flexGrow: '0', flexShrink: '0' };
    const name = screen.getByLabelText('Deduction 1 name');
    expect(name.parentElement).toHaveStyle({ flexDirection: 'column' });
    for (const field of [
      name,
      screen.getByLabelText('Deduction 1 amount').parentElement,
      screen.getByRole('button', { name: 'Deduction 1 goes to' }),
      screen.getByLabelText('Deduction 1 category').parentElement,
      screen.getByLabelText('Deposit 1 account').parentElement,
      screen.getByRole('button', { name: 'Deposit 1 amount type' }),
      screen.getByLabelText('Deposit 1 fixed amount').parentElement,
    ]) {
      expect(field).toHaveStyle(fullWidth);
    }
    expect(
      screen.getByRole('button', { name: 'Deposit 1 amount type' })
        .parentElement,
    ).toHaveStyle({ flexDirection: 'column' });
  });

  it('separates stacked deductions and deposits with a divider on a phone only', async () => {
    const user = userEvent.setup();
    state.paychecks = [
      {
        ...acme,
        definition: {
          ...acme.definition,
          deductions: [
            ...acme.definition.deductions,
            { id: 'dental', name: 'Dental', amount: 1500, category: 'taxes' },
          ],
        },
      },
    ];
    renderPage('acme');
    await user.click(screen.getByRole('button', { name: /^Deductions/ }));
    await user.click(screen.getByRole('button', { name: /^Direct deposits/ }));
    const deduction = (n: number) =>
      screen.getByLabelText(`Deduction ${n} name`).parentElement;
    const deposit = (n: number) =>
      screen.getByLabelText(`Deposit ${n} account`).parentElement?.parentElement
        ?.parentElement;
    const divider = { borderTopWidth: '1px', borderTopStyle: 'solid' };
    expect(deduction(1)).not.toHaveStyle(divider);
    expect(deduction(2)).toHaveStyle({ ...divider, paddingTop: '12px' });
    expect(deposit(1)).not.toHaveStyle(divider);
    expect(deposit(2)).toHaveStyle({ ...divider, paddingTop: '12px' });

    // Desktop rows keep their look
    document.body.innerHTML = '';
    state.isNarrowWidth = false;
    render(
      <TestProviders>
        <PaycheckEditModal paycheckId="acme" />
      </TestProviders>,
    );
    expect(deduction(2)).not.toHaveStyle(divider);
    expect(deposit(2)).not.toHaveStyle(divider);
  });

  it('labels every stacked field on a phone with a short name inside its accessible name', async () => {
    const user = userEvent.setup();
    state.paychecks = [
      {
        ...acme,
        definition: {
          ...acme.definition,
          deductions: [
            ...acme.definition.deductions,
            {
              id: 'hsa',
              name: 'HSA',
              amount: 5000,
              category: null,
              transferAccount: 'savings',
            },
          ],
          deposits: [
            { id: 'savings', account: 'savings', kind: 'fixed', value: 10000 },
            { id: 'checking', account: 'checking', kind: 'percent', value: 5 },
          ],
        },
      },
    ];
    renderPage('acme');
    await user.click(screen.getByRole('button', { name: /^Deductions/ }));
    await user.click(screen.getByRole('button', { name: /^Direct deposits/ }));
    // [visible label, the field's unchanged accessible name]
    const fields = [
      ['Name', 'Deduction 1 name'],
      ['Amount', 'Deduction 1 amount'],
      ['Goes to', 'Deduction 1 goes to'],
      ['Category', 'Deduction 1 category'],
      ['Transfer account', 'Deduction 2 transfer account'],
      ['Account', 'Deposit 1 account'],
      ['Amount type', 'Deposit 1 amount type'],
      ['Fixed amount', 'Deposit 1 fixed amount'],
      ['Percent', 'Deposit 2 percent'],
    ];
    for (const [visible, name] of fields) {
      // Label in name: the words a user sees are part of what's read
      expect(name.toLowerCase()).toContain(visible.toLowerCase());
      const field =
        screen.queryByRole('button', { name }) ?? screen.getByLabelText(name);
      // The field's label is the nearest element with that text before it
      const label = screen
        .getAllByText(visible)
        .filter(
          element =>
            element.compareDocumentPosition(field) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )
        .at(-1);
      expect(label).toHaveStyle({ color: theme.paycheckNoteText });
      // Screen readers already read the field's own name
      expect(label).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.queryByText('Transfer to')).toBeNull();
  });

  it('shows a clear empty state for an empty account or category on a phone', async () => {
    const user = userEvent.setup();
    state.paychecks = [
      {
        ...acme,
        definition: {
          ...acme.definition,
          deductions: [
            { id: 'tax', name: 'Federal tax', amount: 45000, category: null },
          ],
          deposits: [
            { id: 'checking', account: '', kind: 'remainder', value: 0 },
          ],
        },
      },
    ];
    renderPage('acme');
    await user.click(screen.getByRole('button', { name: /^Deductions/ }));
    await user.click(screen.getByRole('button', { name: /^Direct deposits/ }));
    expect(screen.getByLabelText('Deduction 1 category')).toHaveAttribute(
      'placeholder',
      'No category',
    );
    expect(screen.getByLabelText('Deposit 1 account')).toHaveAttribute(
      'placeholder',
      'Choose an account',
    );
  });

  it('keeps desktop rows without the stacked labels', async () => {
    state.isNarrowWidth = false;
    state.paychecks = [acme];
    render(
      <TestProviders>
        <PaycheckEditModal paycheckId="acme" />
      </TestProviders>,
    );
    expect(screen.queryByText('Deduction 1 name')).toBeNull();
    expect(screen.queryByText('Deposit 1 account')).toBeNull();
    expect(screen.getByLabelText('Deduction 1 category')).toHaveAttribute(
      'placeholder',
      'nothing',
    );
  });

  it('makes "Post automatically" one 40px tappable row on a phone', async () => {
    const user = userEvent.setup();
    state.paychecks = [acme];
    renderPage('acme');
    await user.click(screen.getByRole('button', { name: /^Direct deposits/ }));
    const [label] = screen.getAllByText('Post automatically');
    const row = label.closest('label')?.parentElement;
    expect(row).toHaveStyle({ minHeight: '40px' });
    // The label fills the row, so a tap anywhere on it toggles the checkbox
    expect(label.closest('label')).toHaveStyle({
      flexGrow: '1',
      alignSelf: 'stretch',
    });
    const [checkbox] = screen.getAllByRole('checkbox', {
      name: 'Post automatically',
    });
    expect(checkbox).not.toBeChecked();
    await user.click(label);
    expect(checkbox).toBeChecked();
  });

  it('lets the amount fields stretch on desktop as before', async () => {
    const user = userEvent.setup();
    state.isNarrowWidth = false;
    state.paychecks = [acme];
    render(
      <TestProviders>
        <PaycheckEditModal paycheckId="acme" />
      </TestProviders>,
    );
    await user.click(screen.getByRole('button', { name: 'Add deduction' }));
    const amount = screen.getByLabelText('Deduction 2 amount').parentElement;
    expect(amount).toHaveStyle({ width: '110px' });
    expect(amount).not.toHaveStyle({ flexGrow: '0' });
    // Desktop rows stay on one wrapping line
    expect(screen.getByLabelText('Deduction 2 name').parentElement).toHaveStyle(
      { flexDirection: 'row' },
    );
  });

  it('sets Delete paycheck apart as a destructive action', () => {
    state.paychecks = [acme];
    renderPage('acme');
    const remove = screen.getByRole('button', { name: 'Delete paycheck' });
    expect(remove).toHaveStyle({ color: theme.errorText });
    expect(
      screen.getByRole('button', { name: 'Skip next paycheck' }),
    ).not.toHaveStyle({ color: theme.errorText });
  });

  it('opens from the Paychecks section as its own page on a phone', () => {
    const { result } = renderHook(() => useOpenPaycheck(), {
      wrapper: TestProviders,
    });
    result.current();
    expect(state.navigate).toHaveBeenCalledWith('/paychecks/new');
    result.current('acme');
    expect(state.navigate).toHaveBeenCalledWith('/paychecks/acme');
  });
});
