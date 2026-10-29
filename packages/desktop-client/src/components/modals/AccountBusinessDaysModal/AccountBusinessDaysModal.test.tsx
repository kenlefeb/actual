import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { AccountBusinessDaysModal } from './AccountBusinessDaysModal';

const state = vi.hoisted(() => ({
  account: {
    id: 'checking',
    name: 'Checking',
    business_calendar_id: 'reserve' as string | null,
    deposit_days_early: 2,
  },
  mutate: vi.fn(),
}));

const responsive = vi.hoisted(() => ({ isNarrowWidth: false }));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: responsive.isNarrowWidth }),
}));

vi.mock('#hooks/useAccount', () => ({ useAccount: () => state.account }));

vi.mock('#hooks/useBusinessCalendars', () => ({
  useBusinessCalendars: () => ({
    data: [{ id: 'reserve', name: 'U.S. Federal Reserve' }],
  }),
}));

vi.mock('#paychecks', () => ({
  useSetAccountBusinessDaysMutation: () => ({ mutate: state.mutate }),
}));

function renderModal() {
  render(
    <TestProviders>
      <AccountBusinessDaysModal accountId="checking" />
    </TestProviders>,
  );
}

describe('AccountBusinessDaysModal', () => {
  beforeEach(() => {
    state.account.business_calendar_id = 'reserve';
    state.mutate.mockClear();
    responsive.isNarrowWidth = false;
  });

  // shortcut: jsdom does no layout, so the phone-width fit is checked by hand (task 3.2).
  it('saves the calendar and days early at narrow width', async () => {
    responsive.isNarrowWidth = true;
    renderModal();
    const days = screen.getByLabelText(
      'Direct deposits arrive this many business days early',
    );
    await userEvent.clear(days);
    await userEvent.type(days, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.mutate).toHaveBeenCalledWith(
      { id: 'checking', businessCalendarId: 'reserve', depositDaysEarly: 3 },
      expect.anything(),
    );
  });

  it('saves the calendar and days early', async () => {
    renderModal();
    const days = screen.getByLabelText(
      'Direct deposits arrive this many business days early',
    );
    expect(days).toHaveValue(2);
    await userEvent.clear(days);
    await userEvent.type(days, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.mutate).toHaveBeenCalledWith(
      { id: 'checking', businessCalendarId: 'reserve', depositDaysEarly: 1 },
      expect.anything(),
    );
  });

  it('gives every control a touch-sized height at narrow width', () => {
    responsive.isNarrowWidth = true;
    renderModal();
    for (const control of [
      screen.getByLabelText('Business calendar'),
      screen.getByLabelText(
        'Direct deposits arrive this many business days early',
      ),
      screen.getByRole('button', { name: 'Cancel' }),
      screen.getByRole('button', { name: 'Save' }),
    ]) {
      expect(control).toHaveStyle({ minHeight: '40px' });
    }
  });

  it.each(['11', '1.5', '-1'])('rejects %s days early', async value => {
    renderModal();
    const days = screen.getByLabelText(
      'Direct deposits arrive this many business days early',
    );
    await userEvent.clear(days);
    await userEvent.type(days, value);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The number must be a whole number from 0 to 10.',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('says when the calendar was deleted', () => {
    state.account.business_calendar_id = 'gone';
    renderModal();
    expect(screen.getByText(/calendar was deleted/)).toBeInTheDocument();
  });
});
