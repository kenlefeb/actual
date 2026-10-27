import { businessCalendarPresets } from '@actual-app/core/shared/business-calendar-presets';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { BusinessCalendarEditor } from './BusinessCalendarEditor';

const federal = {
  id: 'federal',
  name: 'U.S. Federal Holidays',
  ...businessCalendarPresets[0].calendar,
};

function renderEditor(onSave = vi.fn()) {
  render(
    <TestProviders>
      <BusinessCalendarEditor
        calendar={federal}
        onSave={onSave}
        onDelete={vi.fn()}
      />
    </TestProviders>,
  );
  return onSave;
}

describe('BusinessCalendarEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 5, 1), toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('previews the observed holidays for the selected year', async () => {
    renderEditor();
    const preview = screen.getByRole('list', { name: 'Year preview' });
    const items = within(preview).getAllByRole('listitem');

    expect(items).toHaveLength(11);
    expect(items[0]).toHaveTextContent('Thursday, January 1st, 2026');
    expect(items[0]).toHaveTextContent("New Year's Day");

    await userEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(screen.getByText('Non-business days in 2027')).toBeInTheDocument();
    expect(within(preview).getAllByRole('listitem')).toHaveLength(12);
    expect(
      within(preview).getByText(/Monday, July 5th, 2027/),
    ).toHaveTextContent('Independence Day');
  });

  it('rejects making every weekday non-working', async () => {
    const onSave = renderEditor();
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday']) {
      await userEvent.click(screen.getByRole('checkbox', { name: day }));
    }
    await userEvent.click(screen.getByRole('checkbox', { name: 'Friday' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A calendar needs at least one working weekday.',
    );
    expect(screen.getByRole('checkbox', { name: 'Friday' })).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0].nonWorkingDays).toEqual([0, 1, 2, 3, 4, 6]);
  });
});
