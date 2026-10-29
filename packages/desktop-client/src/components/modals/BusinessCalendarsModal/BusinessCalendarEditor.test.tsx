import { businessCalendarPresets } from '@actual-app/core/shared/business-calendar-presets';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { BusinessCalendarEditor } from './BusinessCalendarEditor';

const responsive = vi.hoisted(() => ({ isNarrowWidth: false }));
vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({
    isNarrowWidth: responsive.isNarrowWidth,
    isWideWidth: !responsive.isNarrowWidth,
  }),
}));

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

  it('edits a holiday as days from Easter', async () => {
    const onSave = renderEditor();
    const [name] = screen.getAllByRole('textbox', { name: 'Holiday name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Good Friday');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Holiday rule type' })[0],
    );
    await userEvent.click(screen.getByText('Days from Easter'));

    const offset = screen.getByRole('spinbutton', {
      name: 'Days from Easter Sunday',
    });
    await userEvent.clear(offset);
    await userEvent.type(offset, '-2');

    const preview = screen.getByRole('list', { name: 'Year preview' });
    expect(
      within(preview).getByText(/Friday, April 3rd, 2026/),
    ).toHaveTextContent('Good Friday');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0].holidays[0]).toEqual({
      id: 'new-years-day',
      name: 'Good Friday',
      kind: 'easter',
      offset: -2,
      observance: 'nearest-weekday',
    });
  });

  async function switchFirstRule(kind: string) {
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Holiday rule type' })[0],
    );
    await userEvent.click(within(screen.getByRole('menu')).getByText(kind));
  }

  it('explains an out-of-range Easter offset and blocks saving it', async () => {
    const onSave = renderEditor();
    await switchFirstRule('Days from Easter');
    const offset = screen.getByRole('spinbutton', {
      name: 'Days from Easter Sunday',
    });
    await userEvent.clear(offset);
    await userEvent.type(offset, '150');
    await userEvent.tab();

    expect(offset).toHaveValue(150);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a whole number of days from -100 to 100.',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.clear(offset);
    await userEvent.type(offset, '50');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(offset).toHaveValue(50);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].holidays[0]).toMatchObject({
      kind: 'easter',
      offset: 50,
    });
  });

  it('switches an Easter rule back to a month-based rule', async () => {
    const onSave = renderEditor();
    await switchFirstRule('Days from Easter');
    await switchFirstRule('Fixed date');

    expect(
      screen.queryByRole('spinbutton', { name: 'Days from Easter Sunday' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0].holidays[0]).toEqual({
      id: 'new-years-day',
      name: "New Year's Day",
      kind: 'fixed',
      month: 1,
      day: 1,
      observance: 'nearest-weekday',
    });
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

  it('keeps the compact dialog layout, with Delete beside Save', () => {
    renderEditor();
    const remove = screen.getByRole('button', { name: 'Delete calendar' });
    const save = screen.getByRole('button', { name: 'Save' });

    // One footer row, Delete first
    expect(remove.parentElement).toBe(save.parentElement);
    expect(
      remove.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(save).not.toHaveStyle({ width: '100%' });

    // Touch-sized minimums are for phones only
    for (const control of [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('textbox'),
      ...screen.getAllByRole('checkbox').map(box => box.closest('label')),
    ]) {
      expect(control).not.toHaveStyle({ minHeight: '40px' });
      expect(control).not.toHaveStyle({ minWidth: '40px' });
    }
  });
});
