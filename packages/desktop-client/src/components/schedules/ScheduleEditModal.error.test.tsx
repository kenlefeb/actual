import { MemoryRouter } from 'react-router';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { ScheduleEditModal } from './ScheduleEditModal';

const CHOOSE = 'Choose the schedule this date is relative to';

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) => name === 'businessCalendars',
}));

vi.mock('#hooks/useScheduleDateLookup', async importActual => ({
  ...(await importActual<object>()),
  useScheduleDateLookup: () => ({ schedules: [], isLoading: false }),
}));

vi.mock('#hooks/useBusinessCalendarLookup', () => ({
  useBusinessCalendarLookup: () => [],
}));

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async () => ({ filters: [] })),
  sendCatch: vi.fn(async () => ({ data: [] })),
}));

vi.mock('#queries/liveQuery', () => ({
  liveQuery: () => ({ unsubscribe: () => undefined }),
}));

describe('ScheduleEditModal form error', () => {
  it('A failed Save shows its message once', async () => {
    render(
      <TestProviders>
        <MemoryRouter>
          <ScheduleEditModal />
        </MemoryRouter>
      </TestProviders>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Date' }));
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Relative to another schedule',
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Date' })).toHaveTextContent(
        'Relative to another schedule',
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findAllByText(CHOOSE)).toHaveLength(1);
    // The empty transactions table keeps its normal message
    expect(screen.queryByText(/Could not search/)).toBe(null);
    expect(screen.getByText('No matching transactions')).toBeInTheDocument();
  });
});
