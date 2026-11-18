import { describe, expect, it, vi } from 'vitest';

import { installBudgetStateReporter, reportBudgetState } from './budgetState';
import type { BudgetStateSnapshot } from './budgetState';

// fork: sc-4942 (task 1.4a). The Mac app's storage-loss warning reads these.
const CLOUD = '7f3c2a1e-9b4d-4c6e-8a2f-0d1e2f3a4b5c';

function start() {
  let listener: () => void = vi.fn();
  let snapshot: BudgetStateSnapshot = {
    loadingText: null,
    managerHasInitialized: false,
    budgetId: undefined,
    cloudFileId: undefined,
    localBudgetCount: null,
  };
  const notify = vi.fn();
  reportBudgetState({
    getSnapshot: () => snapshot,
    subscribe: l => {
      listener = l;
    },
    notify,
  });
  return {
    notify,
    set(next: Partial<BudgetStateSnapshot>) {
      snapshot = { ...snapshot, ...next };
      listener();
    },
    sent: () => notify.mock.calls.map(([message]) => message),
  };
}

describe('budget-state (sc-4942)', () => {
  it('sends open with the cloud file id, never the local id', () => {
    const page = start();
    page.set({ loadingText: 'Opening last budget...' });
    page.set({ budgetId: 'My-Finances-1a2b3c4', cloudFileId: CLOUD });
    page.set({ loadingText: null });
    expect(page.sent()).toEqual([
      { event: 'budget-state', payload: { state: 'open', cloudFileId: CLOUD } },
    ]);
    expect(JSON.stringify(page.sent())).not.toContain('My-Finances');
  });

  it('sends closed with the cloud file id when the budget closes', () => {
    const page = start();
    page.set({ loadingText: 'Loading', budgetId: 'b', cloudFileId: CLOUD });
    page.set({ loadingText: null });
    page.set({ budgetId: undefined, cloudFileId: undefined });
    expect(page.sent()).toContainEqual({
      event: 'budget-state',
      payload: { state: 'closed', cloudFileId: CLOUD },
    });
  });

  it('sends none, with no id, once startup finished with no budget stored', () => {
    const page = start();
    page.set({ loadingText: 'Initializing...' });
    page.set({ managerHasInitialized: true });
    expect(page.sent()).toEqual([]);
    page.set({ loadingText: null });
    // The budget list has not loaded yet: not known to be empty
    expect(page.sent()).toEqual([]);
    page.set({ localBudgetCount: 0 });
    expect(page.sent()).toEqual([
      { event: 'budget-state', payload: { state: 'none' } },
    ]);
  });

  // PR 421 review: a last budget that fails to open is still on this Mac
  it('sends no none when the last budget fails to open but budgets are stored', () => {
    const page = start();
    page.set({ loadingText: 'Opening last budget...', managerHasInitialized: true });
    page.set({ loadingText: null, localBudgetCount: 2 });
    expect(page.sent()).toEqual([]);
  });

  it('sends no none after a close while other budgets are stored', () => {
    const page = start();
    page.set({ loadingText: 'x', budgetId: 'b', cloudFileId: CLOUD });
    page.set({ loadingText: null });
    page.set({
      budgetId: undefined,
      cloudFileId: undefined,
      managerHasInitialized: true,
      localBudgetCount: 1,
    });
    expect(page.sent()).toEqual([
      { event: 'budget-state', payload: { state: 'open', cloudFileId: CLOUD } },
      { event: 'budget-state', payload: { state: 'closed', cloudFileId: CLOUD } },
    ]);
  });

  it('sends nothing before startup has begun or while it is slow', () => {
    const page = start();
    page.set({ managerHasInitialized: true });
    page.set({ loadingText: 'Opening last budget...' });
    page.set({ loadingText: 'Retrieving remote files...' });
    expect(page.sent()).toEqual([]);
  });

  it('sends each state once', () => {
    const page = start();
    page.set({ loadingText: 'x' });
    page.set({
      loadingText: null,
      managerHasInitialized: true,
      localBudgetCount: 0,
    });
    page.set({ loadingText: null });
    expect(page.sent()).toHaveLength(1);
  });

  it('sends no open for a budget without a cloud file id', () => {
    const page = start();
    page.set({ loadingText: 'x', budgetId: 'local-only', cloudFileId: '' });
    page.set({ loadingText: null });
    expect(page.sent()).toEqual([]);
  });
});

describe('installBudgetStateReporter (sc-4942)', () => {
  const MAC_APP =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) HomeEconomicsMac/26.10.1';
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

  function fakeStore() {
    return {
      getState: () => ({
        app: { loadingText: null, managerHasInitialized: false },
        prefs: { local: {} },
        budgetfiles: { allFiles: null },
      }),
      subscribe: vi.fn(),
    };
  }

  function win(userAgent: string, withHandler = true) {
    return {
      navigator: { userAgent },
      ...(withHandler && {
        webkit: {
          messageHandlers: { actualNativeBridge: { postMessage: vi.fn() } },
        },
      }),
    };
  }

  it('installs in the Mac app', () => {
    const store = fakeStore();
    installBudgetStateReporter(win(MAC_APP), store);
    expect(store.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the iPhone app', win(IPHONE)],
    ['a browser', win('Mozilla/5.0 (Macintosh) Safari/605.1.15', false)],
    ['the Mac app without its message handler', win(MAC_APP, false)],
  ])('does nothing in %s', (_, w) => {
    const store = fakeStore();
    installBudgetStateReporter(w, store);
    expect(store.subscribe).not.toHaveBeenCalled();
  });
});
