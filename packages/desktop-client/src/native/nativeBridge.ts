// Fork-only (sc-3584, ADR 11). The page side of the native bridge: Swift
// calls `window.__actualNativeBridge.call(name, args)` and gets the result as
// JSON. The security boundary is the Swift-side allowlist
// (NativeBridgeAllowlist in NativeBridgeClient.swift), which refuses a name
// before it reaches the page. This page-side check only catches mistakes: a
// compromised page can call `send` directly. The Swift tests check that both
// lists match src/data/native-bridge-allowlist.json.
import { listen, send } from '@actual-app/core/platform/client/connection';

import allowlist from '#data/native-bridge-allowlist.json';

type Send = (name: string, args?: unknown) => Promise<unknown>;
type Listen = (name: string, cb: (payload: unknown) => void) => () => void;
type Notify = (message: { event: string; payload: unknown }) => void;

type NativeBridge = {
  call: (name: string, args?: unknown) => Promise<string>;
};

type BridgeWindow = {
  webkit?: {
    messageHandlers?: { actualNativeBridge?: { postMessage: Notify } };
  };
  __actualNativeBridge?: NativeBridge;
};

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    __actualNativeBridge?: NativeBridge;
  }
}

const EVENTS = ['cells-changed', 'sync-event'];

// loot-core's setBudget turns a non-number amount into 0 and writes a row for
// any month or category string, so the bridge checks a write itself (sc-3769).
// Returns only the three fields, so nothing else reaches the handler.
async function validateBudgetAmount(forward: Send, args: unknown) {
  const { category, month, amount } = (args ?? {}) as Record<string, unknown>;
  // A larger number has already lost precision crossing JSON
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    throw new Error('native bridge: amount must be an integer');
  }
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('native bridge: month must be YYYY-MM');
  }
  // Throws "no budget for month" when the month has none
  const snapshot = (await forward('native/budget-month', { month })) as {
    groups: { isIncome: boolean; categories: { id: string }[] }[];
  };
  // Expense categories only, as Swift edits; never a group or income category
  const isCategory = snapshot.groups.some(
    group =>
      !group.isIncome && group.categories.some(cat => cat.id === category),
  );
  if (typeof category !== 'string' || !isCategory) {
    throw new Error(
      'native bridge: category is not an expense category of the month',
    );
  }
  return { category, month, amount };
}

export function createNativeBridge({
  send: forward,
  listen: subscribe,
  notify,
}: {
  send: Send;
  listen: Listen;
  notify: Notify;
}): NativeBridge {
  for (const event of EVENTS) {
    subscribe(event, payload => notify({ event, payload }));
  }
  return {
    async call(name, args) {
      if (!allowlist.includes(name)) {
        throw new Error(`native bridge: ${name} is not allowlisted`);
      }
      if (name === 'budget/budget-amount') {
        args = await validateBudgetAmount(forward, args);
      }
      // A write resolves to undefined, which JSON.stringify does not make a string
      return JSON.stringify((await forward(name, args)) ?? null);
    },
  };
}

export function installNativeBridge(win: BridgeWindow) {
  const handler = win.webkit?.messageHandlers?.actualNativeBridge;
  if (!handler) return;

  // send and listen are typed per handler name; the bridge is dynamic by design
  win.__actualNativeBridge = createNativeBridge({
    send: send as unknown as Send,
    listen: listen as unknown as Listen,
    notify: message => handler.postMessage(message),
  });
  // Native calls refused while another page showed can run again (sc-3859)
  handler.postMessage({ event: 'ready', payload: null });
}
