// Fork-only (sc-4643, openspec/changes/native-settings-screen D1). Native
// Settings reads and the one settings save. `saveSettings` is the single
// validated write every caller uses: `native/settings-save`, web Settings ›
// Limits and the MCP settings tools (mcp-settings-tools). None keeps a copy of
// the closed lists. The contract is settings.test.ts and fixtures/settings.json.
import * as asyncStorage from '#platform/server/asyncStorage';
import { getBudgetType, setType as setBudgetType } from '#server/budget/base';
import * as db from '#server/db';
import { resetFormulaPreferencesCache } from '#server/formulas/bootstrap';
import * as post from '#server/post';
import * as prefs from '#server/prefs';
import { BUDGET_TYPES } from '#server/prefs';
import { getServer } from '#server/server-config';
import * as sheet from '#server/sheet';
import { batchMessages } from '#server/sync';
import { currencies } from '#shared/currencies';
import { UPCOMING_LENGTH_PRESET_VALUES } from '#shared/schedules';
import { dateFormats, numberFormats } from '#shared/util';

import { isLimitId, LIMITS, readLimit, readLimits } from './limits';
import { nativeRefusal } from './refusal';

const BOOLEAN = ['true', 'false'];
const oneOf = (values: readonly string[]) => (v: string) => values.includes(v);

// Each preference native Settings shows, its default as web Settings reads an
// unset value, and the values web Settings stores for it
const PREFS = new Map<
  string,
  { fallback: string; valid: (v: string) => boolean; currency?: true }
>([
  [
    'dateFormat',
    { fallback: 'MM/dd/yyyy', valid: oneOf(dateFormats.map(f => f.value)) },
  ],
  [
    'numberFormat',
    { fallback: 'comma-dot', valid: oneOf(numberFormats.map(f => f.value)) },
  ],
  ['hideFraction', { fallback: 'false', valid: oneOf(BOOLEAN) }],
  ['firstDayOfWeekIdx', { fallback: '0', valid: v => /^[0-6]$/.test(v) }],
  ['budgetType', { fallback: 'envelope', valid: oneOf(BUDGET_TYPES) }],
  ['learn-categories', { fallback: 'true', valid: oneOf(BOOLEAN) }],
  [
    'upcomingScheduledTransactionLength',
    {
      fallback: '7',
      // A preset, or a custom length as CustomUpcomingLength writes it
      valid: v =>
        oneOf(UPCOMING_LENGTH_PRESET_VALUES)(v) ||
        /^[1-9][0-9]{0,2}-(day|week|month|year)$/.test(v),
    },
  ],
  [
    'defaultCurrencyCode',
    { fallback: '', valid: oneOf(currencies.map(c => c.code)), currency: true },
  ],
  [
    'currencySymbolPosition',
    { fallback: 'before', valid: oneOf(['before', 'after']), currency: true },
  ],
  [
    'currencySpaceBetweenAmountAndSymbol',
    { fallback: 'false', valid: oneOf(BOOLEAN), currency: true },
  ],
]);

const CURRENCY_FLAG = 'flags.currency';

async function readStoredPrefs() {
  const ids = [...PREFS.keys(), CURRENCY_FLAG];
  const rows = await db.all<{ id: string; value: string | null }>(
    `SELECT id, value FROM preferences WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  return new Map(rows.map(r => [r.id, r.value]));
}

// Local changes not yet sent to the server: messages newer than the last sync
function syncPending(groupId: string | undefined, since: string | undefined) {
  if (!groupId) return false;
  return (
    db.runQuery<{ one: number }>(
      'SELECT 1 AS one FROM messages_crdt WHERE timestamp > ? LIMIT 1',
      [since ?? ''],
      true,
    ).length > 0
  );
}

/** `native/settings`: local data only, never the network. */
export async function readSettings() {
  const stored = await readStoredPrefs();
  const currency = stored.get(CURRENCY_FLAG) === 'true';
  const shown: Record<string, string> = {};
  for (const [id, { fallback, currency: isCurrency }] of PREFS) {
    if (!isCurrency || currency) shown[id] = stored.get(id) || fallback;
  }
  const { id, budgetName, groupId, encryptKeyId, lastSyncedTimestamp } =
    prefs.getPrefs() ?? {};
  const server = getServer();
  return {
    prefs: shown,
    flags: { currency },
    budget: {
      name: budgetName ?? null,
      id: id ?? null,
      groupId: groupId ?? null,
    },
    encryption: { enabled: Boolean(encryptKeyId) },
    // Only the address and whether a session exists; never the token
    server:
      groupId && server
        ? {
            url: server.BASE_SERVER,
            signedIn: Boolean(await asyncStorage.getItem('user-token')),
          }
        : null,
    sync: { pending: syncPending(groupId, lastSyncedTimestamp) },
    limits: await readLimits(),
  };
}

const UNREACHABLE = { reachable: false, version: null } as const;

/**
 * `native/server-info`: the server's version, waiting at most the
 * `server-info-timeout-seconds` limit. Unreachable is an answer, not an error.
 */
export async function serverInfo(): Promise<
  { reachable: true; version: string } | typeof UNREACHABLE
> {
  const server = getServer();
  if (!server) return UNREACHABLE;
  const seconds = await readLimit('server-info-timeout-seconds');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      post.get(server.BASE_SERVER + '/info'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), seconds * 1000);
      }),
    ]);
    const version = JSON.parse(res)?.build?.version;
    return typeof version === 'string'
      ? { reachable: true, version }
      : UNREACHABLE;
  } catch {
    return UNREACHABLE;
  } finally {
    clearTimeout(timer);
  }
}

// Names no value: a refusal may be logged or shown
function invalid(why: string) {
  return nativeRefusal('invalid-setting', `settings-save: ${why}`);
}

async function validate(changes: unknown) {
  if (
    typeof changes !== 'object' ||
    changes === null ||
    Array.isArray(changes)
  ) {
    throw invalid('changes must be an object');
  }
  const entries = Object.entries(changes);
  if (entries.length === 0) throw invalid('nothing to change');
  let currency: boolean | undefined;
  return Promise.all(
    entries.map(async ([key, value]) => {
      if (isLimitId(key)) {
        // null resets to the default
        if (
          value !== null &&
          !(
            Number.isInteger(value) &&
            value >= 1 &&
            value <= LIMITS[key].ceiling
          )
        ) {
          throw invalid(
            `${key} must be a whole number from 1 to ${LIMITS[key].ceiling}`,
          );
        }
        return { key, value: value === null ? null : String(value) };
      }
      const rule = PREFS.get(key);
      if (!rule) throw invalid('unknown key');
      if (typeof value !== 'string' || !rule.valid(value)) {
        throw invalid(`${key} has no such value`);
      }
      if (rule.currency) {
        currency ??= (await readStoredPrefs()).get(CURRENCY_FLAG) === 'true';
        if (!currency) throw invalid(`${key} needs the currency feature`);
      }
      return { key, value: value as string | null };
    }),
  );
}

/**
 * The one validated settings write. Every key is checked before anything is
 * written; then every key is written in one batch (one transaction), so every
 * device and read sees the old set or the new set. A budget type change then
 * rebuilds the budget, as web Settings does, in the same call.
 */
export async function saveSettings(changes: unknown): Promise<void> {
  const writes = await validate(changes);
  const budgetType = writes.find(w => w.key === 'budgetType')?.value;
  const previousType = budgetType ? getBudgetType() : null;
  if (budgetType) {
    // The cache stays dirty from before the in-memory switch until the
    // rebuild, so a crash anywhere in between rebuilds it on the next start.
    // setType ends its own barrier, so it is opened again after.
    sheet.get().startCacheBarrier();
    // Switched and awaited here, before the write: the write's own switch
    // runs unawaited and would race the cache reset below
    await setBudgetType(budgetType);
    sheet.get().startCacheBarrier();
  }
  try {
    await batchMessages(async () => {
      for (const { key, value } of writes) {
        await db.update('preferences', { id: key, value });
      }
    });
  } catch (e) {
    if (previousType) {
      await setBudgetType(previousType);
      sheet.get().endCacheBarrier();
    }
    throw e;
  }
  if (writes.some(w => !isLimitId(w.key))) resetFormulaPreferencesCache();
  if (budgetType) {
    // Imported here: budgetfiles/app reaches main.ts, which loads this module
    const { resetBudgetCache } = await import('#server/budgetfiles/app');
    await resetBudgetCache();
  }
}
