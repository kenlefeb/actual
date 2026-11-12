import { MemoryRouter } from 'react-router';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobileBackButton } from './MobileBackButton';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => navigate }));

// native-appearance: "Back goes up one level in the iOS app" (sc-3736). No
// useLocation mock: the real router decides the path.
describe('MobileBackButton in a phone browser', () => {
  it.each(['/accounts/1', '/accounts', '/transactions/t1', '/settings'])(
    'follows browser history on %s, even on a tab root',
    async path => {
      navigate.mockClear();
      render(
        <TestProviders>
          <MemoryRouter initialEntries={[path]}>
            <MobileBackButton />
          </MemoryRouter>
        </TestProviders>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(navigate).toHaveBeenCalledExactlyOnceWith(-1);
    },
  );
});
