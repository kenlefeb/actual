import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobileBackButton } from './MobileBackButton';

const navigate = vi.hoisted(() => vi.fn());
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
});
