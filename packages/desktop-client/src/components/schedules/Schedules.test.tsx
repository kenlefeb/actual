import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { Schedules } from '.';

const flags = vi.hoisted(() => ({ businessCalendars: false }));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'businessCalendars' ? flags.businessCalendars : false,
}));

vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => ({
    schedules: [],
    statuses: new Map(),
    isLoading: false,
  }),
}));

vi.mock('./SchedulesTable', () => ({ SchedulesTable: () => null }));

function renderPage() {
  render(
    <TestProviders>
      <Schedules />
    </TestProviders>,
  );
}

describe('Schedules page paychecks', () => {
  beforeEach(() => {
    flags.businessCalendars = false;
  });

  it('offers "Add paycheck" when the feature is on', () => {
    flags.businessCalendars = true;
    renderPage();
    expect(
      screen.getByRole('button', { name: 'Add paycheck' }),
    ).toBeInTheDocument();
  });

  it('hides "Add paycheck" when the feature is off', () => {
    renderPage();
    expect(
      screen.queryByRole('button', { name: 'Add paycheck' }),
    ).not.toBeInTheDocument();
  });
});
