import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { useSyncedPref } from '#hooks/useSyncedPref';
import { TestProviders } from '#mocks';

import { ReconcileBalanceAgeSetting } from './ReconcileBalanceAgeSetting';

vi.mock('#hooks/useSyncedPref', () => ({
  useSyncedPref: vi.fn(),
}));

const setPref = vi.fn();

function mockPref(value: string | undefined) {
  vi.mocked(useSyncedPref).mockReturnValue([value, setPref] as never);
}

const field = () => screen.getByLabelText(/Use the bank balance if synced/);

function renderSetting() {
  render(
    <TestProviders>
      <ReconcileBalanceAgeSetting />
    </TestProviders>,
  );
}

describe('ReconcileBalanceAgeSetting (native-reconcile-flow 1.2a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPref(undefined);
  });

  it('reads the reconcile-bank-balance-max-age-days preference and shows 7 when unset', () => {
    renderSetting();
    expect(useSyncedPref).toHaveBeenCalledWith(
      'reconcile-bank-balance-max-age-days',
    );
    expect(field()).toHaveValue('7');
    expect(screen.getByText('days')).toBeInTheDocument();
  });

  it('shows the stored value', () => {
    mockPref('14');
    renderSetting();
    expect(field()).toHaveValue('14');
  });

  it('shows 7 for a stored value that is out of range', () => {
    mockPref('1e1');
    renderSetting();
    expect(field()).toHaveValue('7');
  });

  it('saves a valid number when the field is left', async () => {
    renderSetting();
    await userEvent.clear(field());
    await userEvent.type(field(), '14');
    expect(setPref).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(setPref).toHaveBeenCalledWith('14');
  });

  it('accepts the ceiling of 30', async () => {
    renderSetting();
    await userEvent.clear(field());
    await userEvent.type(field(), '30');
    await userEvent.tab();
    expect(setPref).toHaveBeenCalledWith('30');
  });

  it.each(['0', '31', '1e1', '0x7', '-3', '7.5', 'abc', ''])(
    'does not save %j and puts the stored value back',
    async bad => {
      mockPref('14');
      renderSetting();
      await userEvent.clear(field());
      if (bad) await userEvent.type(field(), bad);
      await userEvent.tab();
      expect(setPref).not.toHaveBeenCalled();
      expect(field()).toHaveValue('14');
    },
  );
});
