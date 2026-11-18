// Fork-only (sc-4942, add-mac-app-shell task 1.4a). Tells the SwiftUI Mac app
// whether a budget is open, so it can warn when its local data was cleared:
// `open` or `closed` with the budget's cloud file id, or `none` once startup
// has finished with no budget. Never the local budget id, which holds the
// budget's name. Only the Mac app installs it (index.tsx), so the web and the
// iPhone app send nothing new.
import { nativeShell } from '#style/nativeShell';

type ReporterWindow = {
  navigator: { userAgent: string };
  webkit?: {
    messageHandlers?: {
      actualNativeBridge?: { postMessage: (message: unknown) => void };
    };
  };
};

type ReporterStore = {
  getState: () => {
    app: { loadingText: string | null; managerHasInitialized: boolean };
    prefs: { local: { id?: string; cloudFileId?: string } };
  };
  subscribe: (listener: () => void) => unknown;
};

// Only in the SwiftUI Mac app, and only once its message handler exists
export function installBudgetStateReporter(
  win: ReporterWindow,
  store: ReporterStore,
) {
  const handler = win.webkit?.messageHandlers?.actualNativeBridge;
  if (!handler || nativeShell(win) !== 'mac-app') return;
  reportBudgetState({
    getSnapshot: () => {
      const { app, prefs } = store.getState();
      return {
        loadingText: app.loadingText,
        managerHasInitialized: app.managerHasInitialized,
        budgetId: prefs.local.id,
        cloudFileId: prefs.local.cloudFileId,
      };
    },
    subscribe: listener => {
      store.subscribe(listener);
    },
    notify: message => handler.postMessage(message),
  });
}

export type BudgetStateSnapshot = {
  loadingText: string | null;
  managerHasInitialized: boolean;
  budgetId: string | undefined;
  cloudFileId: string | undefined;
};

type Message = {
  event: 'budget-state';
  payload:
    | { state: 'open' | 'closed'; cloudFileId: string }
    | { state: 'none' };
};

export function reportBudgetState({
  getSnapshot,
  subscribe,
  notify,
}: {
  getSnapshot: () => BudgetStateSnapshot;
  subscribe: (listener: () => void) => void;
  notify: (message: Message) => void;
}) {
  // Startup counts as finished only after it has shown a loading message,
  // so the empty state before it begins never reads as "no budget"
  let startupBegan = false;
  let openCloudFileId: string | null = null;
  let last = '';

  function send(message: Message) {
    const key = JSON.stringify(message.payload);
    if (key === last) return;
    last = key;
    notify(message);
  }

  subscribe(() => {
    const { loadingText, managerHasInitialized, budgetId, cloudFileId } =
      getSnapshot();
    if (loadingText !== null) {
      startupBegan = true;
      return;
    }
    if (!startupBegan) return;

    if (budgetId) {
      // Budgets open in the Mac app only by download, so each has a cloud id
      if (!cloudFileId) return;
      openCloudFileId = cloudFileId;
      send({ event: 'budget-state', payload: { state: 'open', cloudFileId } });
      return;
    }
    if (openCloudFileId) {
      const closed = openCloudFileId;
      openCloudFileId = null;
      send({
        event: 'budget-state',
        payload: { state: 'closed', cloudFileId: closed },
      });
    }
    if (managerHasInitialized) {
      send({ event: 'budget-state', payload: { state: 'none' } });
    }
  });
}
