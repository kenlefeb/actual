import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';
import type { ChromeWindow } from '#native/nativeChrome';

import { NativeScreens } from './NativeScreens';

// native-budget-screen: "Settings offers the switch" (sc-3751)
const win = window as unknown as ChromeWindow;

afterEach(() => {
  delete win.webkit;
  delete win.__actualNativeScreens;
});

function insideIosApp(budgetOn = false) {
  const postMessage = vi.fn();
  win.webkit = { messageHandlers: { actualNativeChrome: { postMessage } } };
  win.__actualNativeScreens = { budget: budgetOn };
  return postMessage;
}

function renderSettings() {
  return render(
    <TestProviders>
      <NativeScreens />
    </TestProviders>,
  );
}

describe('NativeScreens', () => {
  it('shows nothing in a browser', () => {
    renderSettings();
    expect(screen.queryByText('Native screens')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('offers the Budget switch inside the iOS app, off by default', () => {
    insideIosApp();
    renderSettings();
    expect(screen.getByText('Native screens')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Native Budget screen/ }),
    ).not.toBeChecked();
  });

  // sc-3778: tracking budgets render natively too, so no web fallback is promised
  it('says when it applies, that it covers envelope and tracking budgets and that budgeted amounts can be edited', () => {
    insideIosApp();
    renderSettings();
    expect(screen.getByText(/next time you open Budget/i)).toBeInTheDocument();
    expect(
      screen.getByText(/envelope and tracking budgets/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/web screen/i)).not.toBeInTheDocument();
    expect(screen.getByText(/edit budgeted amounts and move money/i)).toBeInTheDocument();
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument();
  });

  it('shows the switch as on when the app says it is on', () => {
    insideIosApp(true);
    renderSettings();
    expect(
      screen.getByRole('checkbox', { name: /Native Budget screen/ }),
    ).toBeChecked();
  });

  it('tells the app and flips the checkbox on a click', () => {
    const postMessage = insideIosApp();
    renderSettings();
    const checkbox = screen.getByRole('checkbox', {
      name: /Native Budget screen/,
    });
    fireEvent.click(checkbox);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'nativeScreen',
      screen: 'budget',
      on: true,
    });
    expect(checkbox).toBeChecked();
  });
});
