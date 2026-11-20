// Fork-only (sc-5463). The page posts "ready" as soon as its bridge installs,
// before its own reopen has finished loading the budget, so a native screen
// can read while the database is still opening (a null handle). Every
// native/* handler that touches the budget waits here for a pending open to
// finish, then answers "budget-not-open" so the screen shows its own failure.
// With no open pending (first launch, closed on purpose, a failed open) it
// answers at once; waiting would only hold the screen.
import { LIMITS, readLimit } from './limits';

// Handlers that run before any budget opens (the storage guard is turned on
// before "ready") or that never touch the budget
const UNGATED = new Set([
  'native/persisted',
  'native/storage-state',
  'native/enable-storage-guard',
  'native/server-info',
]);

// A handler that registers only in a test-hooks build names itself here, so
// its name stays out of the production bundle
export function ungated(name: string) {
  UNGATED.add(name);
}

let isOpen = false;
let opening = 0;
let waiters: (() => void)[] = [];

function settle() {
  const woken = waiters;
  waiters = [];
  woken.forEach(wake => wake());
}

export function markBudgetOpen() {
  isOpen = true;
  settle();
}

export function markBudgetClosed() {
  isOpen = false;
}

/** Runs a load of a budget; reads wait on it until it settles. */
export async function whileOpening<T>(load: () => Promise<T>): Promise<T> {
  opening++;
  try {
    return await load();
  } finally {
    opening--;
    settle();
  }
}

// The limit is read from the budget's preferences, so while the database is
// still opening the default applies
async function openWaitMs() {
  return readLimit('native-open-wait-ms').catch(
    () => LIMITS['native-open-wait-ms'].default,
  );
}

async function waitForOpenBudget(
  timeoutMs: number | undefined,
): Promise<boolean> {
  if (isOpen) return true;
  if (opening === 0) return false;
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      settle();
    },
    timeoutMs ?? (await openWaitMs()),
  );
  while (!isOpen && opening > 0 && !timedOut) {
    await new Promise<void>(resolve => waiters.push(resolve));
  }
  clearTimeout(timer);
  return isOpen;
}

// Returns a copy for the main app to combine; the native app itself stays
// ungated, so its own tests can call handlers with no budget load
// shortcut: one flag for the one loaded budget, as loot-core itself has
export function gateNativeHandlers<
  T extends { handlers: object; services: unknown; events: unknown },
>(app: T, timeoutMs?: number): T {
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
