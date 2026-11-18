// Fork-only (sc-4643, openspec/changes/native-settings-screen D11). The one
// registry of configurable limits. Each is a synced preference holding a
// whole number from 1 to its ceiling, read on every call, so a change applies
// to the next call everywhere. Native Settings, web Settings and the MCP
// settings tools list and save exactly these; no handler keeps a copy of a
// default. The MCP server's own limits (its environment and grants) are
// operator-set and never belong here. A new limit adds its name and help line
// here in the same PR. `hasReader` is true once engine code reads the limit
// (limits.test.ts checks it); Settings lists only those, so no setting shown
// does nothing. The story that adds a reader flips it.
import * as db from '#server/db';

export const LIMITS = {
  // native-reconcile-resolve-and-lock D7
  'reconcile-match-max-candidates': {
    name: 'Reconcile: rows searched for a match',
    help: 'Keeps matching fast on a large account',
    default: 300,
    ceiling: 2000,
    hasReader: true,
  },
  'reconcile-match-max-results': {
    name: 'Reconcile: matches shown',
    help: 'Keeps the match list short',
    default: 5,
    ceiling: 20,
    hasReader: true,
  },
  'reconcile-lock-list-max-rows': {
    name: 'Reconcile: rows listed when locking',
    help: 'Keeps the lock summary readable',
    default: 200,
    ceiling: 2000,
    hasReader: true,
  },
  // sc-4386 (native-accounts-screen D2)
  'accounts-register-page-size': {
    name: 'Register: rows per page',
    help: 'Keeps the register fast on a large account',
    default: 50,
    ceiling: 200,
    hasReader: true,
  },
  // sc-4931 (D3): rows per categorize or delete call, children and partners counted
  'accounts-write-max-ids': {
    name: 'Register: rows changed at once',
    help: 'Limits how much one tap can change',
    default: 100,
    ceiling: 500,
    hasReader: true,
  },
  // story 4973 (native-register-upcoming-rows)
  'accounts-register-upcoming-max-days': {
    name: 'Scheduled rows: days ahead',
    help: "Keeps the register's upcoming list bounded",
    default: 92,
    ceiling: 366,
    hasReader: true,
  },
  // story 4973 (native-register-upcoming-rows D8, D11)
  'accounts-upcoming-max-rows': {
    name: 'Scheduled rows: most shown',
    help: 'The most scheduled rows the native register shows and searches (up to 500).',
    default: 100,
    ceiling: 500,
    hasReader: true,
  },
  // story 3602 (native-add-transaction)
  'payee-picker-max-results': {
    name: 'Payee search: results shown',
    help: 'Keeps payee search fast',
    default: 50,
    ceiling: 500,
    hasReader: true,
  },
  'payee-search-max-length': {
    name: 'Payee search: longest search',
    help: 'Keeps search cheap',
    default: 100,
    ceiling: 200,
    hasReader: true,
  },
  'payee-name-max-length': {
    name: 'New payee: longest name',
    help: 'Keeps payee lists readable',
    default: 200,
    ceiling: 500,
    hasReader: true,
  },
  'transaction-notes-max-length': {
    name: 'Notes: longest note',
    help: 'Keeps each transaction small',
    default: 10000,
    ceiling: 50000,
    hasReader: true,
  },
  'transaction-split-max-children': {
    name: 'Splits: most parts',
    help: 'Keeps a split editable',
    default: 50,
    ceiling: 200,
    hasReader: true,
  },
  // sc-4643 (native-settings-screen D1)
  'server-info-timeout-seconds': {
    name: 'About: server check wait',
    help: 'Stops About waiting on a dead server',
    default: 5,
    ceiling: 30,
    hasReader: true,
  },
  // sc-5219 (native-durable-writes D7): under the 5 s bridge deadline; the
  // floor avoids a meaningless "not yet stored" on every write
  'native-persist-wait-ms': {
    name: 'Saving: wait for device storage',
    help: "How long a change waits to be stored on this device before the app says it isn't yet",
    default: 2000,
    floor: 100,
    ceiling: 4000,
    hasReader: true,
  },
} as const;

/** The smallest allowed value: a limit's own floor, else 1. */
export function floorOf(id: LimitId): number {
  const limit = LIMITS[id];
  return 'floor' in limit ? limit.floor : 1;
}

export type LimitId = keyof typeof LIMITS;

export function isLimitId(id: string): id is LimitId {
  return Object.hasOwn(LIMITS, id);
}

// A stored value counts only as a whole number from the floor (1 unless
// the limit sets one) to the ceiling;
// anything else (a bad synced value, a reset) reads as the default
function valueOf(id: LimitId, stored: string | null | undefined) {
  const { default: fallback, ceiling } = LIMITS[id];
  // `Number()` would accept 1e1 and 0x7
  if (stored && /^\d+$/.test(stored)) {
    const n = parseInt(stored, 10);
    if (n >= floorOf(id) && n <= ceiling) return n;
  }
  return fallback;
}

export async function readLimit(id: LimitId): Promise<number> {
  const row = await db.first<{ value: string | null }>(
    'SELECT value FROM preferences WHERE id = ?',
    [id],
  );
  return valueOf(id, row?.value);
}

/** Every limit something reads, in registry order, as Settings lists them. */
export async function readLimits() {
  const ids = (Object.keys(LIMITS) as LimitId[]).filter(
    id => LIMITS[id].hasReader,
  );
  const rows = await db.all<{ id: string; value: string | null }>(
    `SELECT id, value FROM preferences WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  const stored = new Map(rows.map(r => [r.id, r.value]));
  return ids.map(id => ({
    id,
    value: valueOf(id, stored.get(id)),
    default: LIMITS[id].default,
    ceiling: LIMITS[id].ceiling,
  }));
}
