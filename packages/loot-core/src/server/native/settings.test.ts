// Fork-only (sc-4643, openspec/changes/native-settings-screen D1). The
// contract for native Settings: the local read, the server check with its own
// deadline, and the one validated save every caller uses. The Swift tests
// decode fixtures/settings.json, which this file writes. Regenerate with
// `vitest -u`.
// main first, as in the app: budgetfiles/app reaches main.ts, which loads ./app
import '#server/main';
import * as asyncStorage from '#platform/server/asyncStorage';
import { createBudget } from '#server/budget/base';
import * as budgetFiles from '#server/budgetfiles/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as post from '#server/post';
import * as prefs from '#server/prefs';
import { setServer } from '#server/server-config';
import * as sheet from '#server/sheet';
import { clearUndo } from '#server/undo';
import { currencies } from '#shared/currencies';
import { UPCOMING_LENGTH_PRESET_VALUES } from '#shared/schedules';
import { dateFormats, numberFormats } from '#shared/util';

import { app } from './app';
import { LIMITS } from './limits';
import { saveSettings } from './settings';

const h = app.handlers;
const save = (changes: unknown, undoToken = 'T') =>
  h['native/settings-save']({ changes, undoToken } as never);
const pref = async (id: string) =>
  (
    await db.first<{ value: string | null }>(
      'SELECT value FROM preferences WHERE id = ?',
      [id],
    )
  )?.value ?? null;
const setPref = (id: string, value: string) =>
  db.update('preferences', { id, value });
const refused = /^\[native:invalid-setting\] /;

// Keys the MCP server enforces itself; a save naming any is refused
const MCP_OPERATOR_KEYS = [
  'max_rows',
  'max_cells',
  'max_delete_rows',
  'confirm_destructive',
  'allow_reconciled',
  'scopes',
  'maxRows',
  'auditTailBytes',
  'statement-max-age-hours',
  'statementClockSkewMinutes',
];

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await sheet.loadSpreadsheet(db);
  clearUndo();
  setServer(null as never); // setServer takes null to clear it
  vi.restoreAllMocks();
});

afterEach(() => {
  setServer(null as never); // setServer takes null to clear it
  vi.useRealTimers();
});

describe('native/settings', () => {
  it('returns the preferences, budget, sync state and every limit, matching the fixture', async () => {
    await setPref('numberFormat', 'dot-comma');
    await setPref('accounts-register-page-size', '120');
    await prefs.savePrefs({ budgetName: 'Home', groupId: 'group-1' });
    setServer('https://sync.example.com');
    vi.spyOn(asyncStorage, 'getItem').mockResolvedValue('token');
    const fetch = vi.spyOn(post, 'get');
    const settings = await h['native/settings']();
    expect(fetch).not.toHaveBeenCalled();
    expect(settings.prefs).toEqual({
      dateFormat: 'MM/dd/yyyy',
      numberFormat: 'dot-comma',
      hideFraction: 'false',
      firstDayOfWeekIdx: '0',
      budgetType: 'envelope',
      'learn-categories': 'true',
      upcomingScheduledTransactionLength: '7',
    });
    expect(settings.flags).toEqual({ currency: false });
    expect(settings.limits).toContainEqual({
      id: 'accounts-register-page-size',
      value: 120,
      default: 50,
      ceiling: 200,
    });
    expect(settings.limits.map(l => l.id)).toEqual(Object.keys(LIMITS));
    await expect(JSON.stringify(settings, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/settings.json',
    );
  });

  it('adds the currency preferences only while the currency feature is on', async () => {
    await setPref('flags.currency', 'true');
    await setPref('defaultCurrencyCode', 'EUR');
    const settings = await h['native/settings']();
    expect(settings.flags).toEqual({ currency: true });
    expect(settings.prefs).toMatchObject({
      defaultCurrencyCode: 'EUR',
      currencySymbolPosition: 'before',
      currencySpaceBetweenAmountAndSymbol: 'false',
    });
  });

  it('returns the budget name and ids, and encryption off and on', async () => {
    await prefs.savePrefs({ budgetName: 'Home', groupId: 'g1' });
    let settings = await h['native/settings']();
    expect(settings.budget).toEqual({
      name: 'Home',
      id: prefs.getPrefs().id,
      groupId: 'g1',
    });
    expect(settings.encryption).toEqual({ enabled: false });
    await prefs.savePrefs({ encryptKeyId: 'k1' });
    settings = await h['native/settings']();
    expect(settings.encryption).toEqual({ enabled: true });
  });

  it('returns the server for a synced budget and none for a local-only one', async () => {
    setServer('https://sync.example.com');
    expect((await h['native/settings']()).server).toBeNull();
    await prefs.savePrefs({ groupId: 'g1' });
    vi.spyOn(asyncStorage, 'getItem').mockImplementation(async key =>
      key === 'user-token' ? 'secret-token' : undefined,
    );
    const settings = await h['native/settings']();
    expect(settings.server).toEqual({
      url: 'https://sync.example.com',
      signedIn: true,
    });
    // No token, key or secret crosses
    expect(JSON.stringify(settings)).not.toContain('secret-token');
    vi.spyOn(asyncStorage, 'getItem').mockResolvedValue(undefined);
    expect((await h['native/settings']()).server?.signedIn).toBe(false);
  });

  it('says changes are pending while local changes have not been sent', async () => {
    await prefs.savePrefs({ groupId: 'g1' });
    expect((await h['native/settings']()).sync).toEqual({ pending: false });
    // A local change, recorded as sync records it
    const sent = '2026-11-18T10:00:00.000Z-0000-0123456789abcdef';
    const unsent = '2026-11-18T11:00:00.000Z-0000-0123456789abcdef';
    for (const timestamp of [sent, unsent]) {
      db.runQuery(
        "INSERT INTO messages_crdt (timestamp, dataset, row, column, value) VALUES (?, 'preferences', 'dateFormat', 'value', 'S:yyyy-MM-dd')",
        [timestamp],
      );
    }
    await prefs.savePrefs({ lastSyncedTimestamp: sent });
    expect((await h['native/settings']()).sync).toEqual({ pending: true });
    await prefs.savePrefs({ lastSyncedTimestamp: unsent });
    expect((await h['native/settings']()).sync).toEqual({ pending: false });
  });
});

describe('native/server-info', () => {
  it('returns the version of a reachable server', async () => {
    setServer('https://sync.example.com');
    vi.spyOn(post, 'get').mockResolvedValue(
      JSON.stringify({ build: { version: '26.10.1-alpha.37' } }),
    );
    expect(await h['native/server-info']()).toEqual({
      reachable: true,
      version: '26.10.1-alpha.37',
    });
  });

  it('returns unreachable, not an error, when the server fails or there is none', async () => {
    expect(await h['native/server-info']()).toEqual({
      reachable: false,
      version: null,
    });
    setServer('https://sync.example.com');
    vi.spyOn(post, 'get').mockRejectedValue(new Error('network-failure'));
    expect(await h['native/server-info']()).toEqual({
      reachable: false,
      version: null,
    });
  });

  it('stops waiting at its deadline, the default for an out-of-range value', async () => {
    setServer('https://sync.example.com');
    vi.spyOn(post, 'get').mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers();
    await setPref('server-info-timeout-seconds', '99');
    const pending = h['native/server-info']();
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ reachable: false, version: null });
  });
});

describe('native/settings-save', () => {
  it('stores each closed set the way web Settings stores the same choice', async () => {
    for (const { value } of dateFormats) {
      await save({ dateFormat: value });
      expect(await pref('dateFormat')).toBe(value);
    }
    for (const { value } of numberFormats) {
      await save({ numberFormat: value });
      expect(await pref('numberFormat')).toBe(value);
    }
    for (const value of UPCOMING_LENGTH_PRESET_VALUES) {
      await save({ upcomingScheduledTransactionLength: value });
      expect(await pref('upcomingScheduledTransactionLength')).toBe(value);
    }
    // The custom length as CustomUpcomingLength writes it
    await save({ upcomingScheduledTransactionLength: '3-week' });
    expect(await pref('upcomingScheduledTransactionLength')).toBe('3-week');
    for (const value of ['0', '6']) {
      await save({ firstDayOfWeekIdx: value });
      expect(await pref('firstDayOfWeekIdx')).toBe(value);
    }
    for (const key of ['hideFraction', 'learn-categories']) {
      await save({ [key]: 'false' });
      expect(await pref(key)).toBe('false');
      await save({ [key]: 'true' });
      expect(await pref(key)).toBe('true');
    }
  });

  it('accepts the currency preferences only while the currency feature is on', async () => {
    const change = {
      defaultCurrencyCode: 'EUR',
      currencySymbolPosition: 'after',
      currencySpaceBetweenAmountAndSymbol: 'true',
    };
    await expect(save(change)).rejects.toThrow(refused);
    expect(await pref('defaultCurrencyCode')).toBeNull();
    await setPref('flags.currency', 'true');
    for (const { code } of currencies) {
      await save({ defaultCurrencyCode: code });
      expect(await pref('defaultCurrencyCode')).toBe(code);
    }
    await save(change);
    expect(await pref('currencySymbolPosition')).toBe('after');
    await expect(save({ defaultCurrencyCode: 'XXX' })).rejects.toThrow(refused);
  });

  describe('the custom upcoming length (PR #446)', () => {
    const key = 'upcomingScheduledTransactionLength';

    it.each(['1-day', '3-week', '12-month', '999-year'])(
      'stores %s exactly as sent',
      async value => {
        await save({ [key]: value });
        expect(await pref(key)).toBe(value);
      },
    );

    it.each([
      ['zero', '0-day'],
      ['a leading zero', '03-day'],
      ['four digits', '1000-day'],
      ['an unknown unit', '3-fortnight'],
      ['a plural unit', '3-weeks'],
      ['upper case', '3-Week'],
      ['whitespace', ' 3-day'],
      ['trailing whitespace', '3-day '],
      ['a negative', '-3-day'],
      ['NaN', 'NaN-day'],
      ['the literal custom', 'custom'],
    ])('refuses %s with nothing written', async (_, value) => {
      await expect(save({ [key]: value })).rejects.toThrow(refused);
      expect(await pref(key)).toBeNull();
    });

    it('reads an already-stored invalid length back exactly as stored', async () => {
      await setPref(key, 'NaN-day');
      expect((await h['native/settings']()).prefs[key]).toBe('NaN-day');
    });

    it('never blocks saving another setting while the stored length is invalid', async () => {
      await setPref(key, '1000-day');
      await save({ dateFormat: 'yyyy-MM-dd' });
      expect(await pref('dateFormat')).toBe('yyyy-MM-dd');
      expect(await pref(key)).toBe('1000-day');
    });

    it('refuses the invalid stored length sent back unchanged', async () => {
      await setPref(key, '-3-day');
      await expect(
        save({ [key]: '-3-day', dateFormat: 'yyyy-MM-dd' }),
      ).rejects.toThrow(refused);
      expect(await pref('dateFormat')).toBeNull();
    });
  });

  it('stores a limit from 1 to its ceiling, and null resets it to the default', async () => {
    await save({ 'accounts-register-page-size': 1 });
    expect(await pref('accounts-register-page-size')).toBe('1');
    await save({ 'accounts-register-page-size': 200 });
    expect(await pref('accounts-register-page-size')).toBe('200');
    await save({ 'accounts-register-page-size': null });
    expect(await pref('accounts-register-page-size')).toBeNull();
    const limit = (await h['native/settings']()).limits.find(
      l => l.id === 'accounts-register-page-size',
    );
    expect(limit?.value).toBe(50);
  });

  it.each([
    ['an unknown key', { 'csv-mappings-x': '{}' }],
    ['a prototype key', JSON.parse('{"__proto__": "x"}')],
    ['a limit over its ceiling', { 'accounts-write-max-ids': 900 }],
    ['a limit of 0', { 'accounts-write-max-ids': 0 }],
    ['a fractional limit', { 'accounts-write-max-ids': 1.5 }],
    ['a limit as a string', { 'accounts-write-max-ids': '100' }],
    ['a bad date format', { dateFormat: 'yyyy' }],
    ['a bad budget type', { budgetType: 'zero' }],
    ['a day outside 0 to 6', { firstDayOfWeekIdx: '7' }],
    ['a boolean not as stored', { hideFraction: true }],
    ['a null preference', { dateFormat: null }],
    ['empty changes', {}],
    ['no changes object', null],
    ['an array', [['dateFormat', 'yyyy-MM-dd']]],
  ])('refuses %s with nothing written', async (_, changes) => {
    await setPref('accounts-write-max-ids', '100');
    const before = await db.all('SELECT id, value FROM preferences');
    await expect(save(changes)).rejects.toThrow(refused);
    expect(await db.all('SELECT id, value FROM preferences')).toEqual(before);
  });

  it.each(MCP_OPERATOR_KEYS)(
    "refuses the MCP server's own limit %s",
    async key => {
      await expect(save({ [key]: 10 })).rejects.toThrow(refused);
      expect(await pref(key)).toBeNull();
    },
  );

  it('names no value in a refusal', async () => {
    await expect(
      save({ 'accounts-write-max-ids': 'secret-value' }),
    ).rejects.toThrow(/^(?!.*secret-value)/);
  });

  it('needs an undo token', async () => {
    await expect(save({ dateFormat: 'yyyy-MM-dd' }, '')).rejects.toThrow();
    expect(await pref('dateFormat')).toBeNull();
  });

  it('changes neither key when the second of two is bad', async () => {
    await expect(
      save({
        'accounts-register-page-size': 120,
        'accounts-write-max-ids': 900,
      }),
    ).rejects.toThrow(refused);
    expect(await pref('accounts-register-page-size')).toBeNull();
    expect(await pref('accounts-write-max-ids')).toBeNull();
  });

  it('changes neither key when writing the second fails (one batch)', async () => {
    const update = db.update;
    let calls = 0;
    vi.spyOn(db, 'update').mockImplementation(async (table, row) => {
      if (++calls === 2) throw new Error('disk full');
      return update(table, row);
    });
    await expect(
      saveSettings({
        'accounts-register-page-size': 120,
        'accounts-write-max-ids': 300,
      }),
    ).rejects.toThrow('disk full');
    vi.restoreAllMocks();
    expect(await pref('accounts-register-page-size')).toBeNull();
    expect(await pref('accounts-write-max-ids')).toBeNull();
  });

  it('is one undo step through native/undo, with no changed-since check', async () => {
    await setPref('numberFormat', 'comma-dot');
    await setPref('accounts-register-page-size', '60');
    await save(
      { numberFormat: 'dot-comma', 'accounts-register-page-size': 120 },
      'U1',
    );
    // A later change on another device does not stop the undo
    await setPref('dateFormat', 'yyyy-MM-dd');
    await h['native/undo']({ token: 'U1' });
    expect(await pref('numberFormat')).toBe('comma-dot');
    expect(await pref('accounts-register-page-size')).toBe('60');
  });

  it('rebuilds the budget for a budget type change in the same call', async () => {
    global.currentMonth = '2026-03';
    await db.insertCategoryGroup({
      id: 'income',
      name: 'Income',
      is_income: 1,
    });
    await db.insertCategory({
      id: 'salary',
      name: 'Salary',
      cat_group: 'income',
      is_income: 1,
    });
    await createBudget(['2026-02', '2026-03']);
    const reset = vi.spyOn(budgetFiles, 'resetBudgetCache');
    await save({ budgetType: 'tracking' });
    global.currentMonth = null;
    expect(reset).toHaveBeenCalledTimes(1);
    expect(await pref('budgetType')).toBe('tracking');
    expect(sheet.get().meta().budgetType).toBe('tracking');
  });

  it('applies a changed limit to the next read in the running engine', async () => {
    await save({ 'accounts-register-page-size': 120 });
    const { readLimit } = await import('./limits');
    expect(await readLimit('accounts-register-page-size')).toBe(120);
  });
});
