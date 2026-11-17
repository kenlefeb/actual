import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';
import type { ChromeWindow } from '#native/nativeChrome';

import { NativeReconcileBanner } from './NativeReconcileBanner';

// native-reconcile-flow: the Accounts banner (sc-4801, design D1)
const state = vi.hoisted(() => ({
  month: null as unknown,
  send: vi.fn(),
}));

vi.mock(
  '@actual-app/core/platform/client/connection',
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    send: (name: string, args?: unknown) => {
      state.send(name, args);
      return Promise.resolve(state.month);
    },
    listen: () => vi.fn(),
  }),
);

const account = (id: string, status: string) => ({
  id,
  name: id,
  status,
  detail: { cleared: 0, statement: null },
  last_reconciled: null,
});

function inApp(reconcile?: boolean) {
  const postMessage = vi.fn();
  (window as unknown as ChromeWindow).webkit = {
    messageHandlers: { actualNativeChrome: { postMessage } },
  };
  if (reconcile !== undefined) window.__actualNativeScreens = { reconcile };
  return postMessage;
}

const renderBanner = () =>
  render(
    <TestProviders>
      <NativeReconcileBanner />
    </TestProviders>,
  );

afterEach(() => {
  delete (window as { webkit?: unknown }).webkit;
  delete window.__actualNativeScreens;
  state.send.mockClear();
});

describe('NativeReconcileBanner', () => {
  it('shows what is due and opens the native checklist', async () => {
    const postMessage = inApp();
    state.month = {
      month: '2026-11',
      accounts: [
        account('a', 'due'),
        account('b', 'in-progress'),
        account('c', 'done'),
      ],
    };
    renderBanner();
    const banner = await screen.findByRole('button', {
      name: /Reconcile November/,
    });
    expect(banner).toHaveTextContent('2 due · 1 done');
    await userEvent.click(banner);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'presentReconcile',
      checklist: true,
    });
    expect(state.send).toHaveBeenCalledWith(
      'native/reconcile-month',
      undefined,
    );
  });

  it('collapses to a reconciled line when every account is done', async () => {
    inApp();
    state.month = { month: '2026-11', accounts: [account('c', 'done')] };
    renderBanner();
    expect(
      await screen.findByText('November reconciled ✓'),
    ).toBeInTheDocument();
  });

  it('is hidden with the switch off, outside the app, or with no accounts', async () => {
    inApp(false);
    state.month = { month: '2026-11', accounts: [account('a', 'due')] };
    const off = renderBanner();
    expect(off.container).toBeEmptyDOMElement();
    off.unmount();
    delete (window as { webkit?: unknown }).webkit;
    delete window.__actualNativeScreens;
    renderBanner().unmount();
    expect(state.send).not.toHaveBeenCalled();

    inApp();
    state.month = { month: '2026-11', accounts: [] };
    const empty = renderBanner();
    await vi.waitFor(() => expect(state.send).toHaveBeenCalled());
    expect(empty.container).toBeEmptyDOMElement();
  });
});
