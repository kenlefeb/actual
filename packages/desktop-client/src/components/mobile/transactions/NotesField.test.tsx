import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore, TestProviders } from '#mocks';

import { NotesField } from './NotesField';

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isNarrowWidthLoaded: true }),
}));
const env = vi.hoisted(() => ({ isElectron: false }));
vi.mock('@actual-app/core/shared/environment', async importOriginal => ({
  ...(await importOriginal<object>()),
  isElectron: () => env.isElectron,
}));

const openInFileManager = vi.fn();
const writeText = vi.fn().mockResolvedValue(undefined);

function renderNotes(notes: string) {
  const store = createTestAppStore();
  render(
    <TestProviders store={store}>
      <NotesField notes={notes} disabled={false} onFocus={vi.fn()} />
    </TestProviders>,
  );
  return store;
}

describe('NotesField tap targets', () => {
  beforeEach(() => {
    env.isElectron = false;
    openInFileManager.mockClear();
    writeText.mockClear();
    Object.assign(window, { Actual: { openInFileManager } });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  it('starts editing when plain text is tapped', async () => {
    renderNotes('lunch with #work');
    await userEvent.click(screen.getByText(/lunch with/));
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
  });

  it('does not start editing when a tag is tapped, and the tag does nothing else', async () => {
    const store = renderNotes('lunch with #work');
    await userEvent.click(screen.getByText('#work'));
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Notes' })).toBeInTheDocument();
    expect(openInFileManager).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(store.getState().notifications.notifications).toHaveLength(0);
  });

  it('opens the file manager, not the editor, when a file path is tapped in the app', async () => {
    env.isElectron = true;
    renderNotes('see [receipt](/Users/ken/receipt.pdf)');
    await userEvent.click(screen.getByText('receipt'));
    expect(openInFileManager).toHaveBeenCalledWith('/Users/ken/receipt.pdf');
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
  });

  it('copies the path, not the editor, when a file path is tapped in a browser', async () => {
    const store = renderNotes('see [receipt](/Users/ken/receipt.pdf)');
    await userEvent.click(screen.getByText('receipt'));
    expect(writeText).toHaveBeenCalledWith('/Users/ken/receipt.pdf');
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(JSON.stringify(store.getState().notifications)).toContain(
      'File path copied to clipboard',
    );
  });
});
