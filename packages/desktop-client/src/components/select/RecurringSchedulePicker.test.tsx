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
});
