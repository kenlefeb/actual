import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobileBackButton } from './MobileBackButton';

const navigate = vi.hoisted(() => vi.fn());
const location = vi.hoisted(() => ({ pathname: '/accounts/1' }));
vi.mock('react-router', async importActual => ({
  ...(await importActual<Record<string, unknown>>()),
  useLocation: () => location,
}));
vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => navigate }));

describe('MobileBackButton', () => {
  it('is a 40px touch target that fits the 50px header', () => {
    render(
      <TestProviders>
        <MobileBackButton />
      </TestProviders>,
    );
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveStyle({
      minHeight: '40px',
      minWidth: '40px',
      marginTop: '0px',
      marginBottom: '0px',
    });
  });

  it('goes back when pressed', async () => {
    render(
      <TestProviders>
        <MobileBackButton />
      </TestProviders>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  // native-appearance: "Back goes up one level in the iOS app" (sc-3736)
  describe('in the iOS app', () => {
    const inApp = () =>
      vi.stubGlobal('webkit', {
        messageHandlers: { actualNativeChrome: { postMessage: vi.fn() } },
      });
    afterEach(() => {
      vi.unstubAllGlobals();
      navigate.mockClear();
    });

    it.each([
      ['/accounts/1', '/accounts'],
      ['/categories/c1', '/budget'],
      ['/schedules/s1', '/schedules'],
      ['/schedules', '/settings'],
      ['/business-calendars', '/settings'],
    ])('goes from %s up to %s, not through history', async (from, to) => {
      inApp();
      location.pathname = from;
      render(
        <TestProviders>
          <MobileBackButton />
        </TestProviders>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(to);
    });

    it('shows nothing on a screen with no parent', () => {
      inApp();
      location.pathname = '/something-else/1';
      render(
        <TestProviders>
          <MobileBackButton />
        </TestProviders>,
      );
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it("goes from a transaction to the transaction's account when it was not opened from a screen", async () => {
      inApp();
      location.pathname = '/transactions/t1';
      render(
        <TestProviders>
          <MobileBackButton account="acct" />
        </TestProviders>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/accounts/acct');
    });

    it('shows nothing on a tab root', () => {
      inApp();
      location.pathname = '/accounts';
      render(
        <TestProviders>
          <MobileBackButton />
        </TestProviders>,
      );
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });
  });
});
