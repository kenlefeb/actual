import { MemoryRouter, Route, Routes } from 'react-router';

import { businessCalendarPresets } from '@actual-app/core/shared/business-calendar-presets';
import type { BusinessCalendarEntity } from '@actual-app/core/types/models';
import { render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOpenBusinessCalendars } from '#hooks/useOpenBusinessCalendars';
import { TestProviders } from '#mocks';
import type * as Redux from '#redux';

import { MobileBusinessCalendarPage } from './MobileBusinessCalendarPage';
import { MobileBusinessCalendarsPage } from './MobileBusinessCalendarsPage';

const state = vi.hoisted(() => ({
  isNarrowWidth: true,
  isEnabled: true,
  calendars: [] as BusinessCalendarEntity[],
  navigate: vi.fn(),
  dispatch: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({
    isNarrowWidth: state.isNarrowWidth,
    isWideWidth: !state.isNarrowWidth,
  }),
}));

vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => state.navigate }));

vi.mock('#redux', async importOriginal => ({
  ...(await importOriginal<typeof Redux>()),
  useDispatch: () => state.dispatch,
}));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'businessCalendars' && state.isEnabled,
}));

vi.mock('#hooks/useBusinessCalendars', () => ({
  useBusinessCalendars: () => ({
    data: state.calendars,
    isPlaceholderData: false,
  }),
}));

vi.mock('#business-calendars', () => ({
  useCreateBusinessCalendarMutation: () => ({ mutate: state.create }),
  useUpdateBusinessCalendarMutation: () => ({ mutate: state.update }),
  useDeleteBusinessCalendarMutation: () => ({ mutate: state.remove }),
}));

const federal = {
  id: 'federal',
  name: 'U.S. Federal Holidays',
  ...businessCalendarPresets[0].calendar,
} satisfies BusinessCalendarEntity;

function renderAt(path: string) {
  render(
    <TestProviders>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/business-calendars"
            element={<MobileBusinessCalendarsPage />}
          />
          <Route
            path="/business-calendars/:id"
            element={<MobileBusinessCalendarPage />}
          />
          <Route path="/schedules" element={<div>Schedules page</div>} />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
}

// Mutations call onSuccess with the server's result
function succeedWith(mutate: ReturnType<typeof vi.fn>, result?: unknown) {
  mutate.mockImplementation(
    (_payload: unknown, options?: { onSuccess?: (r: unknown) => void }) =>
      options?.onSuccess?.(result),
  );
}

describe('mobile business calendars', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 5, 1), toFake: ['Date'] });
    state.isNarrowWidth = true;
    state.isEnabled = true;
    state.calendars = [federal];
    for (const fn of [
      state.navigate,
      state.dispatch,
      state.create,
      state.update,
      state.remove,
    ]) {
      fn.mockReset();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the list page on a phone and the dialog on desktop', () => {
    const { result, rerender } = renderHook(() => useOpenBusinessCalendars(), {
      wrapper: TestProviders,
    });
    result.current();
    expect(state.navigate).toHaveBeenCalledWith('/business-calendars');
    expect(state.dispatch).not.toHaveBeenCalled();

    state.isNarrowWidth = false;
    rerender();
    result.current();
    expect(state.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { modal: { name: 'business-calendars' } },
      }),
    );
    expect(state.navigate).toHaveBeenCalledTimes(1);
  });

  it('lists calendars and opens one', async () => {
    renderAt('/business-calendars');
    await userEvent.click(
      screen.getByRole('button', { name: 'U.S. Federal Holidays' }),
    );
    expect(state.navigate).toHaveBeenCalledWith('/business-calendars/federal');
  });

  it('creates a calendar from a preset and opens its editor', async () => {
    succeedWith(state.create, 'new-id');
    renderAt('/business-calendars');
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Copy U.S. Federal Reserve preset',
      }),
    );
    expect(state.create.mock.calls[0][0]).toMatchObject({
      name: 'U.S. Federal Reserve',
      nonWorkingDays: [0, 6],
    });
    expect(state.create.mock.calls[0][0].holidays.length).toBeGreaterThan(0);
    expect(state.navigate).toHaveBeenCalledWith('/business-calendars/new-id');
  });

  it('creates an empty calendar', async () => {
    renderAt('/business-calendars');
    await userEvent.click(screen.getByRole('button', { name: 'New calendar' }));
    expect(state.create.mock.calls[0][0]).toEqual({
      name: 'New calendar',
      nonWorkingDays: [0, 6],
      holidays: [],
      exceptions: [],
    });
  });

  it('edits a rule as days from Easter, saves and returns', async () => {
    succeedWith(state.update);
    renderAt('/business-calendars/federal');
    expect(screen.getByRole('textbox', { name: 'Calendar name' })).toHaveValue(
      'U.S. Federal Holidays',
    );

    const [name] = screen.getAllByRole('textbox', { name: 'Holiday name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Good Friday');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Holiday rule type' })[0],
    );
    await userEvent.click(
      within(screen.getByRole('menu')).getByText('Days from Easter'),
    );
    const offset = screen.getByRole('spinbutton', {
      name: 'Days from Easter Sunday',
    });
    await userEvent.clear(offset);
    await userEvent.type(offset, '-2');
    expect(
      within(screen.getByRole('list', { name: 'Year preview' })).getByText(
        /Friday, April 3rd, 2026/,
      ),
    ).toHaveTextContent('Good Friday');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const [saved] = state.update.mock.calls[0];
    expect(saved.id).toBe('federal');
    expect(saved.holidays[0]).toEqual({
      id: 'new-years-day',
      name: 'Good Friday',
      kind: 'easter',
      offset: -2,
      observance: 'nearest-weekday',
    });
    expect(state.navigate).toHaveBeenCalledWith(-1);
  });

  it('shows validation errors and blocks saving a bad offset', async () => {
    renderAt('/business-calendars/federal');
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday']) {
      await userEvent.click(screen.getByRole('checkbox', { name: day }));
    }
    await userEvent.click(screen.getByRole('checkbox', { name: 'Friday' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A calendar needs at least one working weekday.',
    );

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Holiday rule type' })[0],
    );
    await userEvent.click(
      within(screen.getByRole('menu')).getByText('Days from Easter'),
    );
    const offset = screen.getByRole('spinbutton', {
      name: 'Days from Easter Sunday',
    });
    await userEvent.clear(offset);
    await userEvent.type(offset, '150');
    expect(
      screen.getByText('Enter a whole number of days from -100 to 100.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('deletes a calendar and returns', async () => {
    succeedWith(state.remove);
    renderAt('/business-calendars/federal');
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete calendar' }),
    );
    expect(state.remove.mock.calls[0][0]).toBe('federal');
    expect(state.navigate).toHaveBeenCalledWith(-1);
  });

  it('sends users to Schedules when the feature is off', () => {
    state.isEnabled = false;
    renderAt('/business-calendars');
    expect(screen.getByText('Schedules page')).toBeInTheDocument();
  });

  it('sends users to Schedules from an editor when the feature is off', () => {
    state.isEnabled = false;
    renderAt('/business-calendars/federal');
    expect(screen.getByText('Schedules page')).toBeInTheDocument();
  });
});
