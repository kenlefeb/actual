import { businessCalendarPresets } from '@actual-app/core/shared/business-calendar-presets';
import type {
  BusinessCalendarEntity,
  RecurConfig,
} from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { RecurringSchedulePicker } from './RecurringSchedulePicker';

const state = vi.hoisted(() => ({
  flag: true,
  calendars: [] as BusinessCalendarEntity[],
}));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => state.flag,
}));

vi.mock('#hooks/useBusinessCalendars', () => ({
  useBusinessCalendars: () => ({ data: state.calendars }),
}));

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  sendCatch: vi.fn(async () => ({ data: ['2026-07-02'] })),
}));

const federal: BusinessCalendarEntity = {
  id: 'federal',
  name: 'U.S. Federal Holidays',
  ...businessCalendarPresets[0].calendar,
};

const baseConfig: RecurConfig = {
  start: '2026-01-04',
  frequency: 'monthly',
  interval: 1,
  patterns: [],
  skipWeekend: true,
  weekendSolveMode: 'before',
  endMode: 'never',
};

async function openPicker(value: RecurConfig, onChange = vi.fn()) {
  render(
    <TestProviders>
      <RecurringSchedulePicker value={value} onChange={onChange} />
    </TestProviders>,
  );
  await userEvent.click(screen.getByRole('button', { name: /Every month/ }));
  return onChange;
}

describe('RecurringSchedulePicker editing', () => {
  it('keeps a change in progress when the parent re-renders with the same dates', async () => {
    const { rerender } = render(
      <TestProviders>
        <RecurringSchedulePicker value={{ ...baseConfig }} onChange={vi.fn()} />
      </TestProviders>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Every month/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Months' }));
    await userEvent.click(screen.getByText('Weeks'));

    // A parent that isn't memoized passes an equal but new object
    rerender(
      <TestProviders>
        <RecurringSchedulePicker value={{ ...baseConfig }} onChange={vi.fn()} />
      </TestProviders>,
    );

    expect(screen.getByRole('button', { name: 'Weeks' })).toBeInTheDocument();
  });
});

describe('RecurringSchedulePicker business calendars', () => {
  beforeEach(() => {
    state.flag = true;
    state.calendars = [federal];
  });

  it('saves the chosen business calendar', async () => {
    const onChange = await openPicker(baseConfig);

    await userEvent.click(screen.getByRole('button', { name: 'weekends' }));
    await userEvent.click(
      screen.getByText('non-business days in U.S. Federal Holidays'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ businessCalendarId: 'federal' }),
    );
  });

  it('explains a missing calendar', async () => {
    await openPicker({ ...baseConfig, businessCalendarId: 'gone' });

    expect(screen.getByRole('note')).toHaveTextContent(
      'no longer exists, so dates move off weekends only',
    );
    expect(
      screen.getByRole('button', { name: 'missing calendar' }),
    ).toBeInTheDocument();
  });

  it('offers only weekends when the feature is off', async () => {
    state.flag = false;
    await openPicker(baseConfig);

    expect(
      screen.queryByRole('button', { name: 'weekends' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/weekend/, { selector: 'label' }),
    ).toBeInTheDocument();
  });

  it('shows a calendar renamed while the picker is open', async () => {
    const value = { ...baseConfig, businessCalendarId: 'federal' };
    const { rerender } = render(
      <TestProviders>
        <RecurringSchedulePicker value={value} onChange={vi.fn()} />
      </TestProviders>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: /U\.S\. Federal Holidays/ }),
    );
    expect(
      screen.getByRole('button', {
        name: 'non-business days in U.S. Federal Holidays',
      }),
    ).toBeInTheDocument();

    // The calendars query refetches after a rename on another device
    state.calendars = [{ ...federal, name: 'Bank holidays' }];
    rerender(
      <TestProviders>
        <RecurringSchedulePicker value={value} onChange={vi.fn()} />
      </TestProviders>,
    );

    expect(
      screen.getByRole('button', {
        name: 'non-business days in Bank holidays',
      }),
    ).toBeInTheDocument();
    // The trigger's description, behind the open popover
    expect(
      screen.getByText(/before non-business days in Bank holidays\)/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/U\.S\. Federal Holidays/),
    ).not.toBeInTheDocument();
  });
});
