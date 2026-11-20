// Fork-only (sc-5463). The page posts "ready" as soon as its bridge installs,
// before its own reopen has finished loading the budget, so a native screen
// can read while the database is still opening (a null handle). Every
// native/* handler that touches the budget waits here, bounded, for the open
// to finish, then answers "not open yet" so the screen shows its own failure.
// A cold reopen of a large budget; past this the budget is not coming
const OPEN_WAIT_MS = 30_000;

// Handlers that run before any budget opens (the storage guard is turned on
// before "ready") or that never touch the budget
const UNGATED = new Set([
  'native/persisted',
  'native/storage-state',
  'native/enable-storage-guard',
  'native/server-info',
  'native/test-fail-storage',
]);

let isOpen = false;
let waiters: (() => void)[] = [];

export function markBudgetOpen() {
  isOpen = true;
  const ready = waiters;
  waiters = [];
  ready.forEach(wake => wake());
}

export function markBudgetClosed() {
  isOpen = false;
}

function waitForOpenBudget(timeoutMs: number): Promise<boolean> {
  if (isOpen) return Promise.resolve(true);
  return new Promise(resolve => {
    const wake = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      waiters = waiters.filter(w => w !== wake);
      resolve(false);
    }, timeoutMs);
    waiters.push(wake);
  });
}

// Returns a copy for the main app to combine; the native app itself stays
// ungated, so its own tests can call handlers with no budget load
// shortcut: one flag for the one loaded budget, as loot-core itself has
export function gateNativeHandlers<
  T extends { handlers: object; services: unknown; events: unknown },
>(app: T, timeoutMs: number = OPEN_WAIT_MS): T {
  const handlers: Record<string, (args?: unknown) => Promise<unknown>> = {
    ...(app.handlers as Record<string, (args?: unknown) => Promise<unknown>>),
  };
  for (const [name, handler] of Object.entries(handlers)) {
    if (UNGATED.has(name)) continue;
    handlers[name] = async args => {
      if (!(await waitForOpenBudget(timeoutMs))) {
        throw new Error('budget-not-open');
      }
      return handler(args);
    };
  }
  return { ...app, handlers } as T;
}
