import { MemoryRouter, Route, Routes } from 'react-router';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobileScheduleEditPage } from './MobileScheduleEditPage';

const CHOOSE = 'Choose the schedule this date is relative to';

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) => name === 'businessCalendars',
}));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isWideWidth: false }),
}));

vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => vi.fn() }));

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

function renderAddPage() {
  render(
    <TestProviders>
      <MemoryRouter initialEntries={['/schedules/new']}>
        <Routes>
          <Route path="/schedules/:id" element={<MobileScheduleEditPage />} />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('MobileScheduleEditPage relative date', () => {
  it('No error before a source is chosen, and Saving without a source is refused', async () => {
    renderAddPage();

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
    expect(screen.queryByText(/Could not search/)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(CHOOSE))).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The message is shown once after Save, with no "Could not search" echo
    expect(await screen.findAllByText(CHOOSE)).toHaveLength(1);
    expect(screen.queryByText(/Could not search/)).not.toBeInTheDocument();
    expect(screen.getByText('No matching transactions')).toBeInTheDocument();
  });
});
