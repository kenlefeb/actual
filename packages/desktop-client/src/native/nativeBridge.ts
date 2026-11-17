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

type Snapshot = {
  budgetType: string;
  currencyCode: string;
  totals: { toBudget: number | null };
  groups: {
    isIncome: boolean;
    categories: { id: string; balance: number | null }[];
  }[];
};

// The amount and month every write carries, checked; the rest still unknown
function readWrite(
  args: unknown,
): Record<string, unknown> & { amount: number; month: string } {
  const fields = (args ?? {}) as Record<string, unknown>;
  const { amount, month } = fields;
  // A larger number has already lost precision crossing JSON
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    throw new Error('native bridge: amount must be an integer');
  }
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('native bridge: month must be YYYY-MM');
  }
  return { ...fields, amount, month };
}

// Throws "no budget for month" when the month has none
async function readMonth(forward: Send, month: string) {
  return (await forward('native/budget-month', { month })) as Snapshot;
}

// A category of the month's snapshot: never a group id or to-budget, and an
// income category only when `withIncome`
function findCategory(snapshot: Snapshot, id: unknown, withIncome = false) {
  return snapshot.groups
    .filter(group => withIncome || !group.isIncome)
    .flatMap(group => group.categories)
    .find(cat => cat.id === id);
}

// loot-core's setBudget turns a non-number amount into 0 and writes a row for
// any month or category string, so the bridge checks a write itself (sc-3769).
// Returns only the three fields, so nothing else reaches the handler.
async function validateBudgetAmount(forward: Send, args: unknown) {
  const { category, month, amount } = readWrite(args);
  const snapshot = await readMonth(forward, month);
  // As Swift edits (BudgetMonth.editableGroups): income categories only on a
  // tracking budget, the only one with budgeted income
  const withIncome = snapshot.budgetType === 'tracking';
  if (
    typeof category !== 'string' ||
    !findCategory(snapshot, category, withIncome)
  ) {
    throw new Error('native bridge: category cannot be edited in the month');
  }
  return { category, month, amount };
}

// The move-money rules (sc-3787), as Swift's Transfer: an envelope month, a
// positive amount no larger than the source holds, and two different expense
// categories, or to-budget as the destination. A move out of to-budget is
// budget/transfer-available: loot-core's transferCategory would write a
// budget row for a category called to-budget. Returns only the handler's fields.
async function validateTransfer(forward: Send, name: string, args: unknown) {
  const { amount, month, from, to, category } = readWrite(args);
  if (amount <= 0) {
    throw new Error('native bridge: a move needs a positive amount');
  }
  const snapshot = await readMonth(forward, month);
  if (snapshot.budgetType !== 'envelope') {
    throw new Error('native bridge: money moves only on an envelope budget');
  }
  if (name === 'budget/transfer-available') {
    if (!findCategory(snapshot, category)) {
      throw new Error('native bridge: category cannot take the money');
    }
    if (amount > (snapshot.totals.toBudget ?? 0)) {
      throw new Error('native bridge: more than to-budget holds');
    }
    return { month, amount, category };
  }
  const source = findCategory(snapshot, from);
  if (!source || (to !== 'to-budget' && !findCategory(snapshot, to))) {
    throw new Error('native bridge: money cannot move between these');
  }
  if (from === to) {
    throw new Error('native bridge: source and destination are the same');
  }
  if (amount > (source.balance ?? 0)) {
    throw new Error('native bridge: more than the source holds');
  }
  // The currency only labels the movement note: the month's own, as the web's
  return { month, amount, from, to, currencyCode: snapshot.currencyCode };
}

// The nonce Swift makes for a native write, recorded as its undo meta
function readToken(value: unknown) {
  if (typeof value !== 'string' || value === '') {
    throw new Error('native bridge: a native write needs its undo token');
  }
  return value;
}

// A live paycheck's id, checked against a fresh paychecks-get
async function readPaycheckId(forward: Send, id: unknown) {
  const paychecks = (await forward('paychecks-get')) as { id: string }[];
  if (typeof id !== 'string' || !paychecks.some(p => p.id === id)) {
    throw new Error('native bridge: no such paycheck');
  }
  return id;
}

// sc-4341 (skip) and sc-4343 (delete): a write that names a live paycheck
// and carries its undo token. Returns only those fields.
async function validatePaycheckWrite(forward: Send, args: unknown) {
  const { id, undoToken } = (args ?? {}) as Record<string, unknown>;
  const token = readToken(undoToken);
  return { id: await readPaycheckId(forward, id), undoToken: token };
}

type DraftDefinition = {
  clearingAccount?: unknown;
  deposits: { account?: unknown }[];
  deductions: { transferAccount?: unknown }[];
};

function readDefinition(value: unknown): DraftDefinition {
  const definition = value as Partial<DraftDefinition> | null;
  if (
    typeof definition !== 'object' ||
    definition === null ||
    !Array.isArray(definition.deposits) ||
    !Array.isArray(definition.deductions)
  ) {
    throw new Error('native bridge: a paycheck needs its definition');
  }
  return definition as DraftDefinition;
}

// sc-4343: the editor's draft fields, and nothing else
function readDraft(args: unknown) {
  const {
    id,
    name,
    definition,
    isNewAccount,
    newClearingAccountName,
    daysEarly,
  } = (args ?? {}) as Record<string, unknown>;
  readDefinition(definition);
  // A read: loot-core only looks the id up
  return {
    ...(id !== undefined && { id }),
    name,
    definition,
    isNewAccount,
    newClearingAccountName,
    daysEarly,
  };
}

// sc-4343: a save names live accounts only (the clearing account unless it
// creates one, each deposit's, each transfer deduction's and each days-early
// one's) and, when it edits, a live paycheck. Returns only its fields.
async function validatePaycheckSave(forward: Send, args: unknown) {
  const { id, name, definition, newClearingAccountName, daysEarly, undoToken } =
    (args ?? {}) as Record<string, unknown>;
  const token = readToken(undoToken);
  const draft = readDefinition(definition);
  if (id !== undefined) await readPaycheckId(forward, id);
  const days = daysEarly ?? {};
  if (typeof days !== 'object' || Array.isArray(days)) {
    throw new Error('native bridge: days early must be by account');
  }
  if (Object.values(days).some(d => !Number.isInteger(d))) {
    throw new Error('native bridge: days early must be whole numbers');
  }
  const accounts = new Set(
    ((await forward('accounts-get')) as { id: string }[]).map(a => a.id),
  );
  const named = [
    ...(newClearingAccountName ? [] : [draft.clearingAccount]),
    ...draft.deposits.map(d => d.account),
    ...draft.deductions
      .map(d => d.transferAccount)
      .filter(account => account != null),
    ...Object.keys(days),
  ];
  if (named.some(account => !accounts.has(account as string))) {
    throw new Error('native bridge: no such account');
  }
  return {
    ...(id !== undefined && { id }),
    name,
    definition,
    ...(newClearingAccountName !== undefined && { newClearingAccountName }),
    daysEarly: days,
    undoToken: token,
  };
}

// sc-4801: each reconcile handler's own fields. loot-core checks the values
// (native-reconcile-flow D5); a save never carries who, loot-core derives it.
const RECONCILE_FIELDS = new Map([
  ['native/reconcile-rows', ['account_id', 'scope', 'search']],
  ['native/reconcile-tick', ['account_id', 'ids', 'cleared', 'undoToken']],
  ['native/reconcile-list-set', ['excluded']],
  ['account-statement-balance-prefill', ['account_id']],
  // sc-4825
  ['native/reconcile-matches', ['account_id']],
  ['native/reconcile-lock-preview', ['account_id']],
  [
    'native/reconcile-adjust',
    ['account_id', 'amount', 'category_id', 'label', 'undoToken'],
  ],
  ['native/reconcile-lock', ['account_id', 'plan_digest']],
  ['account-statement-balance-get', ['account_id']],
  [
    'account-statement-balance-save',
    ['account_id', 'amount', 'source', 'as_of'],
  ],
]);

function pickFields(args: unknown, fields: string[]) {
  const given = (args ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    fields
      .filter(key => Object.hasOwn(given, key))
      .map(key => [key, given[key]]),
  );
}

// loot-core's sync reasons that native code tells apart (sc-3884); a Map, so a
// reason like "constructor" never reads the prototype
const SYNC_REASONS = new Map([
  ['network-failure', 'network'],
  ['unauthorized', 'unauthorized'],
  ['out-of-sync', 'out-of-sync'],
  ['clock-drift', 'clock-drift'],
  ['encrypt-failure', 'encryption'],
  ['decrypt-failure', 'encryption'],
]);

// Only whether the sync worked and a fixed reason. loot-core's message and
// meta, and a rejection's message, can carry the server address or a response
// body, and messages are raw CRDT data, so none of them cross (sc-3884).
async function sync(forward: Send) {
  try {
    // No arguments, whatever native code sent
    const result = (await forward('sync')) as {
      error?: { reason?: unknown };
    } | null;
    if (!result?.error) return { ok: true };
    const reason = SYNC_REASONS.get(String(result.error.reason)) ?? 'other';
    return { ok: false, reason };
  } catch {
    return { ok: false, reason: 'other' };
  }
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
      if (name === 'sync') {
        return JSON.stringify(await sync(forward));
      }
      if (name === 'budget/budget-amount') {
        args = await validateBudgetAmount(forward, args);
      } else if (name.startsWith('budget/transfer-')) {
        args = await validateTransfer(forward, name, args);
      } else if (name === 'paycheck-skip-next' || name === 'paycheck-delete') {
        args = await validatePaycheckWrite(forward, args);
      } else if (name === 'paycheck-year-to-date') {
        const { id } = (args ?? {}) as Record<string, unknown>;
        args = { id: await readPaycheckId(forward, id) };
      } else if (name === 'native/paycheck-preview') {
        args = readDraft(args);
      } else if (name === 'native/paycheck-save') {
        args = await validatePaycheckSave(forward, args);
      } else if (name === 'native/undo') {
        const { token } = (args ?? {}) as Record<string, unknown>;
        args = { token: readToken(token) };
      } else if (name === 'native/reconcile-month') {
        args = undefined;
      } else if (RECONCILE_FIELDS.has(name)) {
        if (
          name === 'native/reconcile-tick' ||
          name === 'native/reconcile-adjust'
        ) {
          readToken((args as Record<string, unknown> | null)?.undoToken);
        }
        args = pickFields(args, RECONCILE_FIELDS.get(name) ?? []);
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
